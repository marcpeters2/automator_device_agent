import {spawn} from 'child_process';
import env from 'gulp-env';
import gulp from 'gulp';
import babel from 'gulp-babel';
import sourceMaps from 'gulp-sourcemaps';
import nodemon from 'gulp-nodemon';
import mocha from 'gulp-mocha';

function defaultToLocalNodeEnv () {
  env({
    vars: {
      NODE_ENV: process.env.NODE_ENV || 'local',
    }
  });
}

defaultToLocalNodeEnv();

const {config} = require('./src/config');
const srcPattern = 'src/**/*',
  testSrcPattern = 'tests/**/*',
  copyPatterns = ['auth_token.txt'],
  entryPoint = 'dist/src/service.js';
let neverExit = false,
  buildError = false;


gulp.task('build', ['copy'], () => {
  buildError = false;

  return gulp.src([srcPattern, testSrcPattern], {base: '.'})
    .pipe(sourceMaps.init())
    .pipe(babel({
      presets: ['env'],
    }))
    .on('error', function(err) {
      if (neverExit) {
        console.log(err);
        buildError = true;
        this.emit('end');
      } else {
        console.log(err);
        process.exit(1);
      }
    })
    .pipe(sourceMaps.write('.'))
    .pipe(gulp.dest('dist'));
});


gulp.task('copy', () => {
  return gulp.src(copyPatterns, {base: '.'})
    .pipe(gulp.dest('dist'));
});


gulp.task('start', ['build'], (cb) => {
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
    tasks: ['build'],
    ext: 'js',
    ignore: ['dist/**/*', testSrcPattern]
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


gulp.task('test', ['build'], () => {
  env({vars: {NODE_ENV: "test"}});

  if(buildError) {
    return;
  }

  return gulp.src('dist/tests/**/*.js')
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
