var zip = require('bestzip');
const { packageName, version } = require('./public/manifest.json');

zip({
  source: '*',
  destination: `../${packageName}-v${version}.zip`,
})
  .then(function () {
    console.log('all done!');
  })
  .catch(function (err) {
    console.error(err.stack);
    process.exit(1);
  });
