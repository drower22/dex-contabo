/**
 * @file api/_shared/ifood-client.ts
 * @description Cliente HTTP centralizado para API do iFood
 */

import { getIFoodCredentials, getIFoodBaseUrl } from './config';

export type GrantType = 'authorization_code' | 'refresh_token';
export type Scope = 'reviews' | 'financial';

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  merchantId?: string;
}

export interface UserCodeResponse {
  userCode: string;
  authorizationCodeVerifier: string;
  verificationUrl: string;
  expiresIn: number;
}

export interface MerchantInfo {
  id: string;
  name?: string;
  [key: string]: any;
}

/**
 * Cliente centralizado para chamadas à API do iFood
 */
export class IFoodClient {
  private baseUrl: string;

  constructor() {
    this.baseUrl = getIFoodBaseUrl();
  }

  /**
   * Solicita userCode para iniciar fluxo OAuth
   */
  async requestUserCode(scope: Scope): Promise<UserCodeResponse> {
    const { clientId } = getIFoodCredentials(scope);

    const response = await fetch(`${this.baseUrl}/authentication/v1.0/oauth/userCode`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ clientId }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(
        `Failed to request userCode from iFood API (${response.status}): ${error}`
      );
    }

    return (await response.json()) as UserCodeResponse;
  }

  /**
   * Troca authorizationCode por tokens
   */
  async exchangeAuthorizationCode(
    scope: Scope,
    authorizationCode: string,
    authorizationCodeVerifier: string
  ): Promise<TokenResponse> {
    const { clientId, clientSecret } = getIFoodCredentials(scope);

    const response = await fetch(`${this.baseUrl}/authentication/v1.0/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grantType: 'authorization_code',
        clientId,
        clientSecret,
        authorizationCode,
        authorizationCodeVerifier,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(
        `Failed to exchange authorization code (${response.status}): ${error}`
      );
    }

    return (await response.json()) as TokenResponse;
  }

  /**
   * Renova access_token usando refresh_token
   */
  async refreshAccessToken(scope: Scope, refreshToken: string): Promise<TokenResponse> {
    const { clientId, clientSecret } = getIFoodCredentials(scope);

    const response = await fetch(`${this.baseUrl}/authentication/v1.0/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grantType: 'refresh_token',
        clientId,
        clientSecret,
        refreshToken,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(
        `Failed to refresh access token (${response.status}): ${error}`
      );
    }

    return (await response.json()) as TokenResponse;
  }

  /**
   * Valida token e obtém informações do merchant
   */
  async getMerchantInfo(accessToken: string): Promise<MerchantInfo> {
    const response = await fetch(`${this.baseUrl}/merchant/v1.0/merchants/me`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(
        `Failed to get merchant info (${response.status}): ${error}`
      );
    }

    return (await response.json()) as MerchantInfo;
  }

  /**
   * Extrai merchantId de um token JWT ou resposta da API
   */
  extractMerchantId(tokenData: TokenResponse, accessToken?: string): string | null {
    // Método 1: Direto da resposta
    if (tokenData.merchantId) return tokenData.merchantId;
    if ((tokenData as any).merchantID) return (tokenData as any).merchantID;
    if ((tokenData as any).merchant_id) return (tokenData as any).merchant_id;
    if ((tokenData as any).merchant?.id) return (tokenData as any).merchant.id;

    // Método 2: Extrair do JWT
    const token = accessToken || tokenData.accessToken;
    if (!token) return null;

    try {
      const [, payloadB64] = String(token).split('.');
      if (!payloadB64) return null;

      const json = JSON.parse(
        Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')
      );

      // Tentar diferentes claims
      const scopeArr: string[] = json?.merchant_scope || json?.merchantScope || [];
      if (Array.isArray(scopeArr) && scopeArr.length > 0) {
        const first = scopeArr[0];
        const candidate = String(first).split(':')[0];
        if (candidate && candidate.length > 0) return candidate;
      }

      // Outras possibilidades
      if (json?.merchantId) return json.merchantId;
      if (json?.merchant_id) return json.merchant_id;
    } catch (error) {
      console.warn('[ifood-client] Failed to extract merchantId from JWT:', error);
    }

    return null;
  }

  /**
   * Resolve merchantId com múltiplos fallbacks
   */
  async resolveMerchantId(tokenData: TokenResponse): Promise<string | null> {
    // Tentativa 1: Extrair da resposta ou JWT
    let merchantId = this.extractMerchantId(tokenData);
    if (merchantId) return merchantId;

    // Tentativa 2: Chamar /merchants/me
    try {
      const merchantInfo = await this.getMerchantInfo(tokenData.accessToken);
      merchantId = merchantInfo.id || merchantInfo.merchantId || merchantInfo.merchantID;
      if (merchantId) return merchantId;
    } catch (error) {
      console.warn('[ifood-client] Failed to get merchant info:', error);
    }

    return null;
  }
}

/**
 * Instância singleton do cliente
 */
export const ifoodClient = new IFoodClient();
