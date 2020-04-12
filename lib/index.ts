import { OADAClient, Config } from "./client";

/** Create a new instance of OADAClient */
export function createInstance(): OADAClient {
  return new OADAClient();
}

/** Create a new instance and wrap it with Promise */
export async function connect(config: Config): Promise<OADAClient> {
  const instance = createInstance();
  await instance.connect(config);
  return Promise.resolve(instance);
}

export {
  OADAClient,
  Config,
  GETRequest,
  PUTRequest,
  HEADRequest,
  WatchRequest
} from "./client";
