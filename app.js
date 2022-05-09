const dotenv = require('dotenv');

dotenv.config();

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const { createBullBoard } = require('@bull-board/api');
const { BullMQAdapter } = require('@bull-board/api/bullMQAdapter');
const { ExpressAdapter } = require('@bull-board/express');
const { Queue: QueueMQ, Worker, QueueScheduler } = require('bullmq');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const { ensureLoggedIn } = require('connect-ensure-login');

const {
  PORT,
  REDIS_HOST,
  REDIS_PORT,
  REDIS_PASSWORD,
} = process.env;

const sleep = (t) => new Promise((resolve) => setTimeout(resolve, t * 1000));

passport.use(
  new LocalStrategy(function (username, password, cb) {
    if (username === 'bull' && password === 'board') {
      return cb(null, { user: 'bull-board' });
    }
    return cb(null, false);
  })
);

passport.serializeUser((user, cb) => {
  cb(null, user);
});

passport.deserializeUser((user, cb) => {
  cb(null, user);
});


const redisOptions = {
  port: REDIS_PORT,
  host: REDIS_HOST,
  password: REDIS_PASSWORD,
  tls: false,
};

const createQueueMQ = (name) => new QueueMQ(name, { connection: redisOptions });

async function setupBullMQProcessor(queueName) {
  const queueScheduler = new QueueScheduler(queueName, {
    connection: redisOptions,
  });
  await queueScheduler.waitUntilReady();

  new Worker(queueName, async (job) => {
    try {
      for (let i = 0; i <= 100; i++) {
        await sleep(Math.random());
        await job.updateProgress(i);
        await job.log(`Processing job at interval ${i}`);
  
        if (Math.random() * 200 < 1) throw new Error(`Random error ${i}`);
      }
  
      return { jobId: `This is the return value of job (${job.id})` };
    }catch(error) {
      errorExampleBullMq.add('Error', {title: 'error demo test'}, {});
    }
  });
}


const run = async () => {
  const exampleBullMq = createQueueMQ('ExampleBullMQ');
  const errorExampleBullMq = createQueueMQ('ErrorExampleBullMQ');
  const activedBullMqs = {
    exampleBullMq,
    errorExampleBullMq,
  }

  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/ui');

  const boardService = createBullBoard({
    queues: [new BullMQAdapter(exampleBullMq), new BullMQAdapter(errorExampleBullMq)],
    serverAdapter,
  });

  await setupBullMQProcessor(exampleBullMq.name);

  const app = express();

  app.set('views', __dirname + '/views');
  app.set('view engine', 'ejs');

  app.use(session({ secret: 'keyboard cat', saveUninitialized: true, resave: true }));
  app.use(bodyParser.urlencoded({ extended: false }));
  app.use(bodyParser.json());

  app.use(passport.initialize({}));
  app.use(passport.session({}));


  app.get('/ui/login', (req, res) => {
    res.render('login', { invalid: req.query.invalid === 'true' });
  });

  app.post(
    '/ui/login',
    passport.authenticate('local', { failureRedirect: '/ui/login?invalid=true' }),
    (req, res) => {
      res.redirect('/ui');
    }
  );


  app.use('/ui', ensureLoggedIn({ redirectTo: '/ui/login' }), serverAdapter.getRouter());

  app.post('/jobs', (req, res) => {
    const {
      title,
      queueName,
      opts = {},
    } = req.body;

    if (opts.delay) {
      opts.delay = +opts.delay * 1000; // delay must be a number
    }

    const targetBullMq = activedBullMqs[queueName];
    if (targetBullMq) {
      targetBullMq.add('Add', { title }, opts);

      res.send({
        ok: true,
      });
    } else {
      res.send({
        ok: false,
        message: 'queue not found',
      });
    }
  });

  app.post('/jobs/error', (req, res) => {
    const {
      opts = {},
    } = req.body;

      errorExampleBullMq.add('Error', { title: 'some error' }, opts);

      res.send({
        ok: true,
      });
  });

  app.post('/queues', (req, res) => {
    const {
      queueName,
    } = req.body;
    const activedQueue = activedBullMqs[queueName];
    if (activedQueue) {
      return res.status(400).json({
        ok: false,
        message: 'queue already existed.'
      });
    }

    const newActivedQueue = createQueueMQ(queueName);
    activedBullMqs[queueName] = newActivedQueue;
    boardService.addQueue(new BullMQAdapter(newActivedQueue));
    res.send({
      ok: true,
    });
  });

  app.delete('/queues', (req, res) => {
    const {
      queueName,
    } = req.body;
    const activedQueue = activedBullMqs[queueName];
    if (activedQueue) {
      boardService.removeQueue(queueName);
      activedBullMqs[queueName] = undefined;
    }
    res.send({
      ok: true,
    });
  });

  app.post('/worker', async (req, res) => {
    const {
      queueName,
    } = req.body;
    const activedQueue = activedBullMqs[queueName];
    if (activedQueue) {
      await setupBullMQProcessor(queueName);
      return res.status(200).json({
        ok: true,
      });
    }

    res.send({
      ok: true,
    });
  });

  app.listen(PORT, () => {
    console.log(`Running on ${PORT}...`);
    console.log(`For the UI, open http://localhost:${PORT}/ui`);
    console.log('Make sure Redis is running on port 6379 by default');
    console.log('To populate the queue, run:');
    console.log(`  curl http://localhost:${PORT}/add?title=Example`);
    console.log('To populate the queue with custom options (opts), run:');
    console.log(`  curl http://localhost:${PORT}/add?title=Test&opts[delay]=9`);
  });
};

// eslint-disable-next-line no-console
run().catch((e) => console.error(e));
