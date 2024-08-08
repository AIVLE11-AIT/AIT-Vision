const express = require('express');
const process = require('process');
const fs = require('fs');
const log = require('@vladmandic/pilogger');
const multer = require('multer');
const { fork } = require('child_process');
const cors = require('cors');
const path = require('path');

const app = express();
const port = 3000;

app.use(cors());

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});
const upload = multer({ storage: storage });

const maxWorkers = 10;  // 최대 워커 수를 늘립니다.
const workerPool = [];
const pendingJobs = [];
const ffmpegPath = 'ffmpeg'; // ffmpeg 경로를 설정합니다.

const createWorker = (filePath, res) => {
  const worker = fork(path.resolve(__dirname, './videoProcessor.js'), [], {
    env: { ...process.env, FILE_PATH: filePath, FFMPEG_PATH: ffmpegPath }
  });

  worker.on('message', (message) => {
    if (message.type === 'log') {
      log.info(message.data);
    } else if (message.type === 'result') {
      if (!res.headersSent) {
        res.json(message.data);
      }
      log.info(`Worker completed for file: ${filePath}`);
    }
  });

  worker.on('error', (error) => {
    log.error('Worker error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Worker error', details: error.message });
    }
  });

  worker.on('exit', (code) => {
    log.info(`Worker stopped with exit code ${code} for file: ${filePath}`);
    if (code !== 0) {
      log.error('Worker stopped with exit code', code);
      // 실패한 작업을 재시도합니다.
      pendingJobs.push({ filePath, res });
    }
    workerPool.splice(workerPool.indexOf(worker), 1);
    processNextJob();
  });

  workerPool.push(worker);
};

const processNextJob = () => {
  if (workerPool.length < maxWorkers && pendingJobs.length > 0) {
    const { filePath, res } = pendingJobs.shift();
    createWorker(filePath, res);
  }
};

app.post('/process-video', upload.single('video'), (req, res) => {
  if (!req.file) {
    log.error('No file uploaded');
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const filePath = req.file.path;
  pendingJobs.push({ filePath, res });
  log.info(`File uploaded and added to queue: ${filePath}`);
  processNextJob();
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

process.on('exit', () => {
  log.info('Process exiting');
});

process.on('SIGINT', () => {
  log.info('Process interrupted');
  process.exit(0);
});
