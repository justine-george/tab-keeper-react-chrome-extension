const fs = require('fs');

function readJsonFile(filename) {
  const rawData = fs.readFileSync(filename, 'utf-8');
  return JSON.parse(rawData);
}

function writeJsonFile(filename, data) {
  const stringifiedData = JSON.stringify(data, null, 2);
  fs.writeFileSync(filename, stringifiedData, 'utf-8');
}

function updateReadmeVersion(version) {
  let readmeContent = fs.readFileSync('README.md', 'utf-8');
  const versionBadgeRegex =
    /(\[!\[Static Badge]\(https:\/\/img\.shields\.io\/badge\/Version-)([\d.]+)(-blue\?style=for-the-badge\))/;
  readmeContent = readmeContent.replace(versionBadgeRegex, `$1${version}$3`);
  fs.writeFileSync('README.md', readmeContent, 'utf-8');
}

const packageData = readJsonFile('package.json');
const packageVersion = packageData.version;

const manifestData = readJsonFile('public/manifest.json');

manifestData.version = packageVersion;
writeJsonFile('public/manifest.json', manifestData);
updateReadmeVersion(packageVersion);
console.log(`Updated manifest.json and README.md to version ${packageVersion}`);
