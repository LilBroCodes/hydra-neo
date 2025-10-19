function getResource(fileName) {
    return fetch(chrome.runtime.getURL(fileName))
        .then(res => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.text();
        });
}

let config = null;

getResource("files.json")
    .then(text => {
        config = JSON.parse(text);

        if (Array.isArray(config.files)) {
            config.files.forEach(entry => {
                entry.regexObj = new RegExp(entry.regex);
            });
        } else {
            config.files = [];
        }

        if (!Array.isArray(config.urls)) {
            config.urls = [];
        }

        console.log("Loaded config.json:", config);
    })
    .catch(err => {
        console.error("Failed to load config.json:", err);
        config = { urls: [], files: [] };
    });

chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
        if (!config) {
            return {};
        }

        const matchedEntry = config.files.find(entry => entry.regexObj.test(details.url));
        if (!matchedEntry) {
            return {};
        }

        let mainScript = matchedEntry.name || "";

        const filter = chrome.webRequest.filterResponseData(details.requestId);
        const encoder = new TextEncoder();

        getResource(mainScript)
            .then(mainCode => {
                filter.onstart = () => {
                    filter.write(encoder.encode(mainCode));
                    filter.disconnect();
                };
            })
            .catch(err => {
                console.error("Failed to load main script:", err);
                filter.disconnect();
            });

        return {};
    },
    {
        urls: config ? config.urls : ["<all_urls>"],
        types: ["script"]
    },
    ["blocking"]
);