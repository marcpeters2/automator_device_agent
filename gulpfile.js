const {spawn} = require('child_process');
const env = require('gulp-env');
const gulp = require('gulp');
const nodemon = require('gulp-nodemon');
const mocha = require('gulp-mocha');

function defaultToLocalNodeEnv () {
  env({
    vars: {
      NODE_ENV: process.env.NODE_ENV || 'local',
    }
  });
}

defaultToLocalNodeEnv();

const srcPattern = 'src/**/*',
  testSrcPattern = 'tests/**/*',
  entryPoint = 'src/service.js';
let neverExit = false;


gulp.task('start', (cb) => {
  const serverProcess = spawn('node', [entryPoint]);

  serverProcess.stdout.on('data', (data) => {
    process.stdout.write(data);
  });

  serverProcess.stderr.on('data', (data) => {
    process.stderr.write(data);
  });

  //TODO: Not sure which of these are really necessary
  serverProcess.on('exit', cb);
  serverProcess.on('error', cb);
  serverProcess.on('end', cb);
});


gulp.task('watch', () => {
  const stream = nodemon({
    script: entryPoint,
    ext: 'js',
    ignore: [testSrcPattern]
  });

  stream
    .on('restart', () => {
      console.log('Source changed; restarting service');
    })
    .on('crash', () => {
      console.log('Service crashed; restarting service');
      stream.emit('restart', 2);
    });
});


gulp.task('test', () => {
  env({vars: {NODE_ENV: "test"}});

  return gulp.src('tests/**/*.js')
    .pipe(mocha())
    .on('error', function(err) {
      if (neverExit) {
        this.emit('end');
      } else {
        console.log(err);
        process.exit(1);
      }
    });
});


gulp.task('tdd', () => {
  neverExit = true;
  gulp.start('test');
  return gulp.watch([srcPattern, testSrcPattern], ['test']);
});
