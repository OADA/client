/**
 * @license
 * Copyright 2023 Open Ag Data Alliance
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

import debug from "debug";
import { EventEmitter } from "eventemitter3";
import { JSONPath } from "jsonpath-plus";
import { deserializeError } from "serialize-error";

import type Job from "@oada/types/oada/service/job.js";
//import { postUpdate } from '@oada/jobs';

import type { Change, Json, OADAClient } from "./index.js";
import type { ChangeBody, Result } from "./utils.js";
import { buildChangeObject, changeSym } from "./utils.js";

const log = {
  trace: debug("@oada/client/jobs:trace"),
  error: debug("@oada/client/jobs:error"),
  info: debug("@oada/client/jobs:info"),
  fatal: debug("@oada/client/jobs:fatal"),
};

export class JobsRequest<J extends Job> {
  job: J;
  oadaId?: string;
  oadaListKey?: string;
  oada: OADAClient;
  readonly #emitter;
  // @ts-expect-error expect for now
  #watch?;

  constructor({ oada, job }: { oada: OADAClient; job: J }) {
    this.job = job;
    this.oada = oada;
    this.#emitter = new EventEmitter<JobEventTypes<J>, this>();
  }

  async on<E extends JobEventType>(
    event: E,
    listener: (jobChange: JobType<E, J>) => PromiseLike<void> | void,
  ) {
    this.#emitter.on(event, this.#wrapListener(event, listener));
  }

  async start() {
    const pending = `/bookmarks/services/${this.job.service}/jobs/pending`;
    const { headers } = await this.oada.post({
      path: `/resources`,
      data: this.job as unknown as Json,
      contentType: "application/vnd.oada.service.jobs.1+json",
    });
    const _id = headers["content-location"]?.replace(/^\//, "") ?? "";
    const key = _id.replace(/^resources\//, "");
    //    Const { _id, key } = await postJob(this.oada, pending, this.job as Json);
    this.oadaId = _id;
    this.oadaListKey = key;
    this.#watch = await this.#watchJob();
    await this.oada.put({
      path: `${pending}/${key}`,
      data: {
        _id,
      },
    });
    return { _id, key };
  }

  /*
  async postUpdate(update: string | Json, status: string): Promise<void> {
    return postUpdate(this.oada, this.oadaId!, update, status || 'in-progress');
  }
  */

  #wrapListener<E extends JobEvent<J>>(
    type: string,
    listener: (jobChange: E) => void | PromiseLike<void>,
  ) {
    return async (jobChange: E) => {
      try {
        await listener(jobChange);
      } catch (error: unknown) {
        log.error(
          {
            type,
            listener: listener.name,
            error,
          },
          "Error in job listener",
        );
      }
    };
  }

  async #emit<E extends JobEventType>(event: E) {
    const getJob = this.#getJob.bind(this);
    let jobP: Promise<J>;
    const out = {
      get job() {
        if (jobP === undefined) {
          jobP = getJob();
        }

        return jobP;
      },
    };
    switch (event) {
      case JobEventType.Success: {
        this.#emitter.emit(JobEventType.Success, out);
        break;
      }

      case JobEventType.Status: {
        this.#emitter.emit(JobEventType.Status, out);
        break;
      }

      case JobEventType.Failure: {
        this.#emitter.emit(JobEventType.Failure, out);
        break;
      }

      case JobEventType.Result: {
        this.#emitter.emit(JobEventType.Result, out);
        break;
      }

      case JobEventType.Update: {
        this.#emitter.emit(JobEventType.Update, out);
        break;
      }

      default: {
        this.#emitter.emit(event, out);
        break;
      }
    }
  }

  async #watchJob() {
    const result = await this.oada.watch({
      path: `/${this.oadaId}`,
      rev: 0,
      type: "tree",
    });

    const { changes } = result;

    // eslint-disable-next-line github/no-then
    void this.#handleChangeFeed(changes).catch((error: unknown) =>
      this.#emitter.emit("error", error),
    );

    log.info({ this: this }, "Job watch initialized");
    return changes;
  }

  async #handleChangeFeed(
    watch: AsyncIterable<ReadonlyArray<Readonly<Change>>>,
  ): Promise<never> {
    for await (const [rootChange, ...children] of watch) {
      const changeBody = buildChangeObject(rootChange!, ...children);
      await this.#handleJobChanges(changeBody);
    }

    log.fatal("Change feed ended unexpectedly");
    throw new Error("Change feed ended");
  }

  async #handleJobChanges(changeBody: ChangeBody<unknown>) {
    // eslint-disable-next-line new-cap
    const items = JSONPath<Array<Result<ChangeBody<J>>>>({
      resultType: "all",
      path: `$`,
      json: changeBody,
    });
    for await (const { value } of items) {
      const { [changeSym]: changes } = value;
      for await (const change of changes ?? []) {
        log.trace({ change }, "Received change");

        // TODO: determine whether we can get a resource at a particular rev

        // Emit generic item change event
        if (change?.body?.status === "success")
          await this.#emit(JobEventType.Success);

        if (change?.body?.status) await this.#emit(JobEventType.Status);

        if (change?.body?.status === "failure")
          await this.#emit(JobEventType.Failure);

        if (
          change.type === "merge" &&
          change?.body?._rev >= 2 &&
          change?.body?.result
        )
          await this.#emit(JobEventType.Result);

        if (change.type === "merge" && change?.body?.updates)
          await this.#emit(JobEventType.Update);
      }
    }
  }

  async #getJob(): Promise<J> {
    // Needed because TS is weird about asserts...
    // const assertJob: TypeAssert<Job> = this.#assertJob;
    const { data } = await this.oada.get({
      path: `/${this.oadaId}`,
    });
    // AssertJob(item);
    return data as unknown as J;
  }
}

export enum JobEventType {
  // The job is finished; a status arrives
  Status = "Status",
  // Success status
  Success = "Success",
  // Fail status
  Failure = "Failure",
  // Result arrived
  Result = "Result",
  // Update comes into the job
  Update = "Update",
  /*
  // Job completed, any status result
  Done = 'Done',
  */
}

// The actual event payload
export interface JobEvent<J = never> {
  readonly job: Promise<J>;
}

// Lookup of arguments that are received for each given event
export interface JobEventTypes<J> {
  [JobEventType.Success]: [JobEvent<J>];
  [JobEventType.Status]: [JobEvent<J>];
  [JobEventType.Failure]: [JobEvent<J>];
  [JobEventType.Result]: [JobEvent<J>];
  [JobEventType.Update]: [JobEvent<J>];
  error: unknown[];
}

// A single argument set
export type JobType<E extends JobEventType, J> = JobEventTypes<J>[E][0];

// TODO: should this be a JobConfig?
export const doJob = async (oada: OADAClient, job: Job): Promise<Job> =>
  new Promise((resolve, reject) => {
    const jr = new JobsRequest({ oada, job });
    jr.on(JobEventType.Status, async ({ job: jo }) => {
      const index = await jo;
      if (index.status === "success") {
        resolve(index);
      } else if (index.status === "failure") {
        reject(deserializeError(index.result));
      }
    }).catch(reject);
    jr.start();
  });
