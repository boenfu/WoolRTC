interface IRequest<TParams extends object, TData> {
  params: TParams;
  data: TData;
}

export type Request = GetGists | GetGist | CreateGist | UpdateGist;

export type GetGists = IRequest<{}, GistInfo[]>;

export type GetGist = IRequest<{}, GistInfo | undefined>;

export type CreateGist = IRequest<
  {
    description: string;
    files: {
      [key in string]: {
        content: string;
      };
    };
  },
  {
    id: string;
  }
>;

export type UpdateGist = IRequest<
  {
    description?: string;
    files?: {
      [key in string]: {
        content: string;
        filename?: string | null;
      };
    };
  },
  {
    id: string;
  }
>;

export interface GistFileInfo {
  filename: string;
  raw_url: string;
}

export interface GistInfo {
  id: string;
  description: string;
  files: {
    [key in string]: GistFileInfo;
  };
}

export class Gist {
  constructor(public token: string) {}

  async getList(): Promise<GistInfo[]> {
    return this.request<GetGists>('GET');
  }

  async get(id: string): Promise<GistInfo | undefined> {
    return this.request<GetGist>('GET', id);
  }

  async create(params: CreateGist['params']): Promise<CreateGist['data']> {
    return this.request<CreateGist>('POST', undefined, params);
  }

  async update(
    id: string,
    params: UpdateGist['params'],
  ): Promise<UpdateGist['data']> {
    return this.request<UpdateGist>('PATCH', id, params);
  }

  async getFileJson<T>(info: GistFileInfo | string): Promise<T> {
    return (await this.getFile(info)).json();
  }

  async getFileText(info: GistFileInfo | string): Promise<string> {
    return (await this.getFile(info)).text();
  }

  private async getFile(info: GistFileInfo | string): Promise<Response> {
    return fetch(typeof info === 'string' ? info : info.raw_url);
  }

  private async request<TRequest extends Request>(
    method: 'GET' | 'POST' | 'PATCH',
    id?: string,
    params: TRequest['params'] = {},
  ): Promise<TRequest['data']> {
    return fetch(
      `https://api.github.com/gists${id ? `/${id}` : ''}${
        isGetRequest(method, params)
          ? `?${String(
              new URLSearchParams({
                ...params,
                // no-cache
                t: String(Date.now()),
              }),
            )}`
          : ''
      }`,
      {
        ...(isGetRequest(method, params) ? {} : {body: JSON.stringify(params)}),
        method,
        headers: {
          Accept: 'application/vnd.github.v3+json',
          Authorization: `token ${this.token}`,
        },
      },
    ).then(r => (String(r.status).startsWith('2') ? r.json() : ({} as any)));
  }
}

function isGetRequest(
  method: string,
  params: any,
): params is Record<string, string> {
  return method === 'GET';
}
