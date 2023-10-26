import fetch from "node-fetch-cache";

export interface FetchWrapper {
  fetch(url: string, options?: any): Promise<any>;
}

export const httpClient: FetchWrapper = {
  fetch: async (url: string, options?: any): Promise<any> => {
    console.log(`{http client} Fetching ${url}`);
    return fetch(url, options);
  },
};
