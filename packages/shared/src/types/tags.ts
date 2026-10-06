export interface GitTag {
  name: string;
  objectHash: string;
  objectType: string;
  commitHash?: string;
  type: 'lightweight' | 'annotated';
  message: string;
  tagger: string;
}

export interface RemoteTag {
  name: string;
  objectHash: string;
}

export interface CreateTagOptions {
  name: string;
  target?: string;
  type: 'lightweight' | 'annotated';
  message?: string;
}

export interface DeleteTagOptions {
  name: string;
  objectHash: string;
  confirmed: boolean;
  remote?: string;
  remoteObjectHash?: string;
}

export interface PushTagOptions {
  remote: string;
  name?: string;
  all?: boolean;
}

export interface CheckoutTagOptions {
  name: string;
  objectHash: string;
  branch?: string;
  confirmed?: boolean;
}
