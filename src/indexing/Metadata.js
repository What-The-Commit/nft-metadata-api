import fetch from "node-fetch";

class Metadata {
    constructor(ipfsHosts) {
        this.ipfsHosts = ipfsHosts;
    }

    async getMetadata(metadataUrl, tokenId) {
        let calledUrl;
        let response;
        let responseBody;

        let metadata = new URL(metadataUrl);

        try {
            switch (metadata.protocol) {
                case "ipfs:":
                    const requests = [];

                    for (const ipfsHost of this.ipfsHosts) {
                        calledUrl = ipfsHost + '/ipfs/' + metadata.host.replace('ipfs/', '') + metadata.pathname;
                        const call = new Promise(async function (resolve, reject) {
                            try {
                                const response = await fetch(calledUrl);

                                if (response.status === 200) {
                                    resolve(response);
                                }

                                reject(response.status);
                            } catch (e) {
                                reject(e);
                            }
                        });

                        requests.push(call);
                    }

                    response = await Promise.any(requests);
                    responseBody = await response.text();

                    if (responseBody.indexOf('invalid ipfs path: ') !== -1) {
                        let error = new Error('IPFS metadata error');
                        error.responseBody = responseBody;
                        error.url = 'https://ipfs.io/ipfs/' + metadata.host.replace('ipfs/', '') + metadata.pathname;

                        throw error;
                    }

                    responseBody = JSON.parse(responseBody);
                    responseBody.tokenId = tokenId;

                    return responseBody;
                case "http:":
                case "https:":
                    calledUrl = metadata.href;
                    response = await fetch(calledUrl);
                    responseBody = await response.text();
                    responseBody = JSON.parse(responseBody);

                    responseBody.tokenId = tokenId;

                    return responseBody;
                case "data:":
                    responseBody = JSON.parse(atob(metadata.href.replace('data:application/json;base64,', '')));
                    responseBody.tokenId = tokenId;

                    return responseBody;
            }
        } catch (error) {
            error.url = metadataUrl;
            error.calledUrl = calledUrl;
            error.parsedUrl = metadata;
            error.response = response;
            error.responseBody = responseBody;
            throw error;
        }
    }
}

export default Metadata;