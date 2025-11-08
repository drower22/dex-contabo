import os
import sys
import argparse
from supabase import create_client, Client
from dotenv import load_dotenv

# --- Carregamento Robusto do .env ---
script_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(script_dir)
dotenv_path = os.path.join(project_root, '.env')
load_dotenv(dotenv_path=dotenv_path)

def main():
    parser = argparse.ArgumentParser(description='Faz upload de um arquivo para uma pasta de cliente no Supabase Storage.')
    parser.add_argument('--filepath', required=True, help='Caminho completo para o arquivo local.')
    parser.add_argument('--bucket-name', required=True, help='Nome do bucket de destino.')
    parser.add_argument('--file-id', required=True, help='ID único para o arquivo.')
    parser.add_argument('--account-id', required=True, help='ID da conta do cliente para criar a pasta.')
    args = parser.parse_args()

    try:
        url = os.environ.get("SUPABASE_URL")
        key = os.environ.get("SUPABASE_KEY")

        if not url or not key:
            raise ValueError("As variáveis de ambiente SUPABASE_URL e SUPABASE_KEY são obrigatórias.")

        if not os.path.exists(args.filepath):
            raise FileNotFoundError(f"O arquivo de origem '{args.filepath}' não foi encontrado.")
        
        supabase: Client = create_client(url, key)
        bucket_name = args.bucket_name
        
        # Cria o caminho no bucket, incluindo a pasta do cliente e o nome do arquivo prefixado
        original_filename = os.path.basename(args.filepath)
        file_name_with_prefix = f"{args.file_id}_{original_filename}"

        # Garante nome único: se já existir um com o mesmo nome, prefixa com timestamp
        account_folder = args.account_id.strip('/')
        try:
            entries = supabase.storage.from_(bucket_name).list(path=account_folder)
            existing_names = {e.get('name') for e in (entries or []) if isinstance(e, dict)}
        except Exception:
            existing_names = set()

        final_name = file_name_with_prefix
        if file_name_with_prefix in existing_names:
            from datetime import datetime
            ts = datetime.now().strftime('%Y%m%d-%H%M%S')
            final_name = f"{ts}_" + file_name_with_prefix

        path_in_bucket = f"{account_folder}/{final_name}"

        print(f"Iniciando upload de '{args.filepath}' para o caminho '{path_in_bucket}' no bucket '{bucket_name}'...")

        # Define as opções do arquivo, incluindo o Content-Type correto para .xlsx
        # NUNCA sobrescrever: upsert = false
        file_options = {"cache-control": "3600", "upsert": "false"}
        if original_filename.endswith('.xlsx'):
            file_options['content-type'] = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            print(f"INFO: Content-Type para .xlsx definido como '{file_options['content-type']}'")

        with open(args.filepath, 'rb') as f:
            # A biblioteca supabase-py levanta uma exceção em caso de falha no upload.
            # Se nenhuma exceção for levantada, o upload foi bem-sucedido.
            supabase.storage.from_(bucket_name).upload(
                path=path_in_bucket,
                file=f,
                file_options=file_options
            )
        
        print(f"SUCESSO: Arquivo enviado com sucesso para o caminho '{path_in_bucket}' no bucket '{bucket_name}'.")

    except Exception as e:
        print(f"ERRO CRÍTICO: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
