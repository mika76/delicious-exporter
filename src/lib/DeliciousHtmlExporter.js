import fs from "fs";
import request from "request-promise";
import progressbar from "progressbar";
import HtmlParser from "./HtmlParser.js";
import UrlVerifier from "./UrlVerifier.js";

class RemoteHttpLoader {

  constructor(baseEndpoint, username) {
    this.username = username;
    this.baseEndpoint = baseEndpoint;
  }

  loadPage(page) {
    return new Promise((resolve, reject) => {
      request(`${this.baseEndpoint}/${this.username}?page=${page}`)
        .then(resolve, reject);
    });
  }

}

class LocalFileLoader {

  constructor(filePrefix, fileSuffix) {
    this.filePrefix = filePrefix;
    this.fileSuffix = fileSuffix;
  }

  loadPage(page) {
    return new Promise((resolve, reject) => {
      fs.readFile(`${this.filePrefix}${page}${this.fileSuffix}`, 'utf8', (err, data) => {
        if (err) {
          reject({
                   message: err.message
                 });
        } else {
          resolve(data.toString());
        }
      });
    });
  }

}

class LocalFileWriter {

  constructor(filePrefix, fileSuffix) {
    this.filePrefix = filePrefix;
    this.fileSuffix = fileSuffix;
  }

  savePage(page, data) {
    return new Promise((resolve, reject) => {
      fs.writeFile(`${this.filePrefix}${page}${this.fileSuffix}`, data, 'utf8', (err) => {
        if (err) {
          reject({
                   message: err.message
                 });
        } else {
          resolve();
        }
      });
    });
  }

}

class ResultVerifier {

  constructor({verbose = false}, {urls = false}) {
    this.verbose = verbose;
    this.urlVerifier = urls
      ? new UrlVerifier({verbose: verbose})
      : null;
  }

  verify(items) {
    const progress = progressbar.create().step('item result validation');
    progress.setTotal(items.length);
    return Promise.all(items.map(item => this.verifyItem(item, progress)))
                  .then(() => {
                    progress.finish();
                    return items;
                  });
  }

  verifyItem(item, progress) {
    return Promise.all([
                         this.verifyItem_url(item)
                       ])
                  .then(() => {
                    if (progress) {
                      progress.addTick();
                    }
                    return item;
                  });
  }

  verifyItem_url(item) {
    if (!this.urlVerifier) {
      return Promise.resolve(item);
    }
    const applyResult = result => {
      item.validity = item.validity || {};
      item.validity.url = result;
    };
    return new Promise((resolve) => {
      if (this.verbose) {
        console.log(`Verify item ${item.id} '${item.title}: ${item.url}'`);
      }
      this.urlVerifier.verify(item.url)
          .then(applyResult, applyResult)
          .then(() => {
            if (this.verbose) {
              console.log(`Verify item ${item.id} '${item.title}: ${item.url}' COMPLETED`);
            }
            resolve(item);
          })
          .catch(() => resolve(item));
    });
  }

}

class DeliciousHtmlExporter {

  constructor({username, baseEndpoint = 'https://del.icio.us', writeHtmlToDirectory = false, readHtmlFromDirectory = false, validityOptions = {}}) {
    this.verbose = false;
    if (readHtmlFromDirectory) {
      this.loader = new LocalFileLoader(`${readHtmlFromDirectory}/page_`, '.html');
    } else {
      this.loader = new RemoteHttpLoader(baseEndpoint, username);
    }
    if (writeHtmlToDirectory && typeof writeHtmlToDirectory === 'string') {
      if (!fs.existsSync(writeHtmlToDirectory)) {
        fs.mkdirSync(writeHtmlToDirectory);
      }
      this.writer = new LocalFileWriter(`${writeHtmlToDirectory}/page_`, '.html');
    }
    this.parser = new HtmlParser();
    this.verifier = new ResultVerifier({verbose: this.verbose}, validityOptions);

    console.log(`Starting del.icio.us HTML exporter for '${username}' @ '${baseEndpoint}'`);
    console.log('  - reading from ' + (readHtmlFromDirectory ? (`<local: '${readHtmlFromDirectory}'>`) : `<remote: ${baseEndpoint}>` ));
    console.log('  - writing results ' + (writeHtmlToDirectory ? (`yes <local: ${writeHtmlToDirectory}>`) : 'no'));
    console.log(`  - validating results (urls=${validityOptions.urls ? 'yes' : 'no'})`);
  }

  fetch() {
    return new Promise((resolve, reject) => {
      const progress = progressbar.create();
      this.fetchPage()
          .then(response => {
            let combinedResult = {
              title: response.title,
              pages: response.page.total,
              totalElements: response.page.totalElements,
              items: []
            };
            console.log(`Fetched initial page, and now we know how many to load: ${response.page.total} pages, ${response.page.totalElements} items`);
            progress.step('page fetching')
                    .setTotal(response.page.total);
            return this.collectAndFetchNext(response, combinedResult, progress);
          })
          .then(result => {
            progress.finish();
            if (this.verifier) {
              if (this.verbose) {
                console.log(`Now verifying all ${result.items.length} items...`);
              }
              return this.verifier
                         .verify(result.items)
                         .then(() => result, () => result);
            } else {
              return result;
            }
          })
          .then(resolve, reject);
    });
  }

  fetchPage(page = 1) {
    return this.loader.loadPage(page)
               .then((html) => {
                 if (this.writer) {
                   this.writer.savePage(page, html)
                       .catch(error => console.error('Failed to write page due: ' + error.message));
                 }
                 return this.parser.parse(html);
               })
               .then(response => {
                 if (this.verbose) {
                   console.log(`Fetched page ${response.page.number}/${response.page.total}`);
                 }
                 return response;
               });
  }

  collectAndFetchNext(currentResponse, combinedResult, progress) {
    return new Promise((resolve, reject) => {
      if (progress) {
        progress.addTick();
      }
      combinedResult.items.push(...currentResponse.items);
      if (currentResponse.page.next) {
        this.fetchPage(currentResponse.page.next)
            .then(nextResponse => this.collectAndFetchNext(nextResponse, combinedResult, progress))
            .then(resolve, reject);
      } else {
        resolve(combinedResult);
      }
    });
  }

}

export default DeliciousHtmlExporter;
