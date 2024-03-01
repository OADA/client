/**
 * @license
 * Copyright 2021 Open Ag Data Alliance
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { domain, token } from './config.js';

import { setTimeout } from 'node:timers/promises';

import ava, { type TestFn } from 'ava';

import { Service, type WorkerFunction } from '@oada/jobs';

import {
  JobEventType,
  JobsRequest,
  type OADAClient,
  connect,
  doJob,
  // eslint-disable-next-line node/no-extraneous-import
} from '@oada/client';

const JOBTYPE = 'test-type';
const SERVICE = 'test-service';

const testJob = {
  type: JOBTYPE,
  service: SERVICE,
  config: {
    somekey: 'xyz',
    foo: { bar: 'baz' },
  },
} as const;
const throwJob = {
  type: JOBTYPE,
  service: SERVICE,
  config: {
    error: true,
    somekey: 'xyz',
    foo: { bar: 'baz' },
  },
} as const;

interface Context {
  conn: OADAClient;
}
const test = ava as TestFn<Context>;

const testWorker: WorkerFunction = async (job: any) => {
  if (job.config.error) throw new Error('some error');
  return { great: 'success' };
};

test.before('Create connection and dummy service', async (t) => {
  t.context.conn = await connect({
    domain,
    token,
  });

  const svc = new Service({
    name: SERVICE,
    oada: t.context.conn,
  });

  svc.on(JOBTYPE, 60_000, testWorker);
  await svc.start();
});

test('Should wait for the job to finish', async (t) => {
  const results: any = {};
  const someJob = new JobsRequest({
    oada: t.context.conn,
    job: testJob,
  });
  void someJob.on(JobEventType.Success, () => {
    results.success = true;
  });

  void someJob.on(JobEventType.Failure, () => {
    results.failure = true;
  });

  void someJob.on(JobEventType.Result, () => {
    results.result = true;
  });

  void someJob.on(JobEventType.Update, () => {
    results.update = true;
  });

  await someJob.start();

  await setTimeout(3000);

  await t.context.conn.put({
    path: `/${someJob.oadaId}`,
    data: { status: 'success' },
  });

  await t.context.conn.put({
    path: `/${someJob.oadaId}`,
    data: { status: 'failure' },
  });

  await t.context.conn.put({
    path: `/${someJob.oadaId}`,
    data: { result: { some: { result: 'data' } } },
  });

  await someJob.postUpdate('update the job', 'some status');

  t.true(results?.success);
  t.true(results?.failure);
  t.true(results?.result);
  t.true(results?.update);

  const { data } = await t.context.conn.get({
    path: `/${someJob.oadaId}`,
  });

  t.is(
    // @ts-expect-error too lazy to fix
    Object.values(data.updates).pop().meta,
    'update the job',
  );
});

test('doJob should return the job after a status (and result) are available.', async (t) => {
  const job = await doJob(t.context.conn, testJob);

  t.is(job.status, 'success');
  t.deepEqual(job.result, { great: 'success' });
});

test('doJob should throw an error if the worker throws.', async (t) => {
  const error = await t.throwsAsync(async () =>
    doJob(t.context.conn, throwJob),
  );

  t.is(error.message, 'some error');
});
