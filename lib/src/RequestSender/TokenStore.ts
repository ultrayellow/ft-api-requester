import { FetchConfig, sendRequest } from './sendRequest.js';
import { sleepMs } from '../util/sleepMs.js';
import { ApiClientConfig } from './ApiClientConfig.js';
import { RateLimiter } from './RateLimiter.js';

interface TokenDto {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  created_at: number;
}

export interface Token {
  readonly accessToken: string;
  readonly createdAt: number;
  readonly expiredAt: number;
  readonly rateLimiter: RateLimiter;
}

const DEFAULT_RATE_LIMIT_CONFIG = {
  rateLimitPerHour: 1200,
  rateLimitPerSec: 2,
} satisfies Partial<ApiClientConfig>;

const DEFAULT_FETCH_CONFIG = {
  retryCount: 3,
  retryInterval: 1000,
  errorStatusFn: (status: number): boolean => status >= 400,
} satisfies FetchConfig;

export class TokenStore {
  private readonly apiClientConfig: Required<ApiClientConfig>;
  private readonly fetchConfig = DEFAULT_FETCH_CONFIG;

  private token: Token | null = null;

  constructor(apiClientConfig: ApiClientConfig) {
    this.apiClientConfig = {
      ...DEFAULT_RATE_LIMIT_CONFIG,
      ...apiClientConfig,
    };
  }

  public getApiClientId = (): string => {
    return this.apiClientConfig.clientId;
  };

  public getToken = async (): Promise<Token> => {
    const currToken = this.token;

    if (isEmptyToken(currToken) || isExpiredToken(currToken)) {
      const tokenPayload = await this.issueToken();

      this.token = convertDtoToken(this.apiClientConfig, tokenPayload);

      console.log(`token expiresAt: ${this.token.expiredAt}`);
      return this.token;
    }

    return currToken;
  };

  private issueToken = async (): Promise<Readonly<TokenDto>> => {
    const response = await sendRequest(this.fetchConfig, {
      endPoint: 'oauth/token',
      init: {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: this.apiClientConfig.clientId,
          client_secret: this.apiClientConfig.clientSecret,
        }),
      },
    });

    const tokenPayload: unknown = await response.json();
    assertIsTokenDto(tokenPayload);

    console.log(`token issued: ${tokenPayload.access_token}`);

    return tokenPayload;
  };
}

function assertIsTokenDto(
  tokenPayload: unknown,
): asserts tokenPayload is TokenDto {
  if (
    typeof tokenPayload === 'object' &&
    tokenPayload &&
    'access_token' in tokenPayload &&
    'token_type' in tokenPayload &&
    'expires_in' in tokenPayload &&
    'scope' in tokenPayload &&
    'created_at' in tokenPayload
  ) {
    return;
  }

  throw Error('library outdated');
}

const convertDtoToken = (
  apiClientConfig: Required<ApiClientConfig>,
  tokenDto: Readonly<TokenDto>,
): Token => {
  return {
    accessToken: tokenDto.access_token,
    createdAt: toMilliseconds(tokenDto.created_at),
    expiredAt: getExpiredDate(tokenDto.expires_in),
    rateLimiter: new RateLimiter(apiClientConfig),
  };
};

const isEmptyToken = (token: Token | null): token is null => {
  return token === null;
};

const isExpiredToken = (token: Token): boolean => {
  const currTime = new Date().getTime();
  return currTime >= token.expiredAt;
};

const getExpiredDate = (expiresIn: number): number => {
  const currTime = new Date().getTime();
  return floorUnderSeconds(currTime + toMilliseconds(expiresIn));
};

const toMilliseconds = (seconds: number): number => {
  return seconds * 1000;
};

const floorUnderSeconds = (milliseconds: number): number => {
  return (milliseconds / 1000) * 1000;
};
