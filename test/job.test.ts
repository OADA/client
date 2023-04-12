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

/* eslint-disable sonarjs/no-duplicate-string */

import { domain, token } from './config.js';

import test from 'ava';

import type { WorkerFunction } from '@oada/jobs';
import { Service } from '@oada/jobs';

import type { OADAClient } from '../dist/index.js';
import { connect, JobsRequest, JobEventType, doJob } from '../dist/index.js';

let conn: OADAClient;
const JOBTYPE= 'test-type';
const SERVICE = 'test-service';

const testJob = {
  type: JOBTYPE,
  service: SERVICE,
  config: {
    somekey: 'xyz',
    foo: { bar: 'baz' },
  }
}
const throwJob = {
  type: JOBTYPE,
  service: SERVICE,
  config: {
    error: true,
    somekey: 'xyz',
    foo: { bar: 'baz' },
  }
}


const testWorker: WorkerFunction = async (job: any) => {
  if (job.config.error) throw new Error('some error');
  return {great: 'success'};
};

test.before('Create connection and dummy service', async () => {
  conn = await connect({
    domain,
    token,
  });

  const svc = new Service({
    name: SERVICE,
    oada: conn,
  });

  svc.on(JOBTYPE, 60_000, testWorker);
  await svc.start();
});

test(`Should wait for the job to finish `, async (t) => {
  let results : any = {};
  const someJob = new JobsRequest({
    oada: conn,
    job: testJob,
  });
  someJob.on(JobEventType.Success, () => {
    results.success = true;
  });

  someJob.on(JobEventType.Failure, () => {
    results.failure = true;
  });

  someJob.on(JobEventType.Result, () => {
    results.result= true;
  });

  someJob.on(JobEventType.Update, () => {
    results.update = true;
  });

  await new Promise((resolve) => setTimeout(resolve, 3000));

  await conn.put({
    path: `/${someJob.oadaId}`,
    data: {status: 'success'},
  });

  await conn.put({
    path: `/${someJob.oadaId}`,
    data: {status: 'failure'},
  });

  await conn.put({
    path: `/${someJob.oadaId}`,
    data: { result: { some: { result: 'data' } } },
  });

  await someJob.postUpdate('update the job', 'some status');

  t.is(results?.success, true);
  t.is(results?.failure, true);
  t.is(results?.result, true);
  t.is(results?.update, true);

  let { data } = await conn.get({
    path: `/${someJob.oadaId}`,
  })

  // @ts-expect-error too lazy to fix
  t.is(Object.values(data.updates)[1].meta === 'update the job');
});

test('doJobs should return the job after a status (and result) are available.', async (t) => {

  const job = await doJob(conn, testJob);

  t.is(job.status, 'success')
  t.deepEqual(job.result, { great: 'success'});
})

test.only('doJobs should throw an error if the worker throws.', async (t) => {

  const err = await t.throwsAsync(async () => await doJob(conn, throwJob));

  t.deepEqual(err!.message, 'some error')
})