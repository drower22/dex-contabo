import pandas as pd
import numpy as np
from datetime import datetime, timedelta

# Colunas esperadas pelo script process_report.py
EXPECTED_COLUMNS = [
    'id_do_pedido', 'id_do_pedido_na_loja', 'data_do_pedido', 'canal_de_venda',
    'valor_dos_produtos', 'taxa_de_entrega', 'taxa_adicional_de_entrega',
    'taxa_de_servico', 'descontos', 'beneficios_ifood', 'valor_total_do_pedido',
    'valor_liquido_do_pedido', 'tipo_de_pagamento', 'metodo_de_pagamento',
    'id_da_transacao_do_pagamento', 'tipo_de_pedido', 'modalidade_de_entrega',
    'entregador', 'id_do_cliente', 'nome_do_cliente', 'cpf_na_nota'
]

def create_dummy_report(filename="dummy_report.xlsx", num_rows=50):
    """
    Cria um arquivo Excel de relatório do iFood com dados fictícios.
    """
    data = []
    start_date = datetime(2023, 10, 1, 10, 0, 0)

    for i in range(num_rows):
        row_date = start_date + timedelta(hours=i * 2, minutes=i*15)
        product_value = round(np.random.uniform(20.0, 150.0), 2)
        delivery_fee = round(np.random.uniform(5.0, 15.0), 2)
        service_fee = round(product_value * 0.1, 2)
        discount = round(np.random.uniform(0.0, 10.0), 2)
        total_value = product_value + delivery_fee + service_fee - discount
        net_value = total_value * 0.8 # Simula comissão

        row = {
            'id_do_pedido': f'ORDER-{i+1:05d}',
            'id_do_pedido_na_loja': f'STORE-{i+1:03d}',
            'data_do_pedido': row_date.strftime('%d/%m/%Y %H:%M'),
            'canal_de_venda': 'iFood',
            'valor_dos_produtos': f'R$ {product_value:.2f}'.replace('.', ','),
            'taxa_de_entrega': f'R$ {delivery_fee:.2f}'.replace('.', ','),
            'taxa_adicional_de_entrega': 'R$ 0,00',
            'taxa_de_servico': f'R$ {service_fee:.2f}'.replace('.', ','),
            'descontos': f'R$ {discount:.2f}'.replace('.', ','),
            'beneficios_ifood': 'R$ 0,00',
            'valor_total_do_pedido': f'R$ {total_value:.2f}'.replace('.', ','),
            'valor_liquido_do_pedido': f'R$ {net_value:.2f}'.replace('.', ','),
            'tipo_de_pagamento': 'ONLINE',
            'metodo_de_pagamento': 'Cartão de Crédito',
            'id_da_transacao_do_pagamento': f'TRANS-{i+1:06d}',
            'tipo_de_pedido': 'ENTREGA',
            'modalidade_de_entrega': 'MOTO',
            'entregador': f'Entregador {i % 5 + 1}',
            'id_do_cliente': f'CUST-{i+1:04d}',
            'nome_do_cliente': f'Cliente Fictício {i+1}',
            'cpf_na_nota': '' # Deixar vazio como nos casos reais
        }
        data.append(row)

    df = pd.DataFrame(data, columns=EXPECTED_COLUMNS)
    
    # Adiciona uma linha com dados inválidos para teste de robustez
    invalid_row = data[0].copy()
    invalid_row['valor_dos_produtos'] = 'VALOR_INVALIDO'
    df.loc[len(df)] = invalid_row

    # Salva na pasta 'data' que está um nível acima
    output_path = f"../data/{filename}"
    df.to_excel(output_path, index=False, engine='openpyxl')
    print(f"Relatório fictício '{output_path}' criado com sucesso com {len(df)} linhas.")

if __name__ == "__main__":
    create_dummy_report()
