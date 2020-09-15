/*
 * Copyright 2020 Spotify AB
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

import knex from 'knex';
import * as winston from 'winston';
import { Config, ConfigReader } from '@backstage/config';
import {
  loadBackendConfig,
  createStatusCheckRouter,
  createServiceBuilder,
} from '@backstage/backend-common';
import { createRouter } from '@backstage/plugin-auth-backend';
import { PluginEnvironment } from './types';
import {
  createInterceptorRouter,
  createLocalAuthRouter,
} from './tokeninterceptor';

function makeLogger(config: Config) {
  const logLevel = config.getOptionalString('logLevel') || 'info';

  const logger = winston.createLogger({
    level: logLevel,
    format: winston.format.json(),
    defaultMeta: { service: config.getString('app.title') },
    transports: [new winston.transports.Console({ silent: false })],
  });

  return logger;
}

function makeEnv(
  config: Config,
  logger: winston.Logger,
): PluginEnvironment | {} {
  try {
    const db = knex({
      client: 'sqlite3',
      connection: ':memory',
      useNullAsDefault: true,
    });

    db.client.pool.on('createSuccess', (_eventId: any, resource: any) => {
      resource.run('PRAGMA foreign_keys = ON', () => {});
    });

    return { logger, config, database: db };
  } catch (e) {
    console.log(e);
    return {};
  }
}

async function main() {
  const config = ConfigReader.fromConfigs(await loadBackendConfig());
  const logger = makeLogger(config);
  const env = makeEnv(config, logger) as PluginEnvironment;

  const authRouter = await createRouter(env);
  const interceptorRouter = await createInterceptorRouter(config, logger);
  const healthCheckRouter = await createStatusCheckRouter({
    logger: logger,
    path: '/healthcheck',
  });

  const localAuthRouter = await createLocalAuthRouter(config, logger);

  const service = createServiceBuilder(module)
    .loadConfig(config)
    .enableCors({ origin: config.getString('app.baseUrl'), credentials: true })
    .addRouter('', healthCheckRouter)
    .addRouter('/auth', authRouter)
    .addRouter('/auth-local', localAuthRouter)
    .addRouter('/token', interceptorRouter);

  await service.start().catch(err => {
    console.error(err);
    process.exit(1);
  });

  module.hot?.accept();
}

main().catch(value => {
  console.log(value);
  console.error(`Backend failed to start up, ${value}`);
  process.exit(1);
});
