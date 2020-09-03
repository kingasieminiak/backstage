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

import { Config, ConfigReader } from '@backstage/config';
import * as winston from 'winston';
import * as router from './router';
import * as express from 'express';
import { InterceptorEnvironment } from '../types';

function makeEnv(
  config: Config,
  logger: winston.Logger,
): InterceptorEnvironment | {} {
  try {
    const usersApiEndpoint = config.getString(
      'backend.tokenInterceptor.usersApiEndpoint',
    );
    const tokenEndpoint = config.getString(
      'backend.tokenInterceptor.tokenEndpoint',
    );
    const jwtSigningKey = config.getString(
      'backend.tokenInterceptor.jwtSigningKey',
    );
    const devToken = config.getString('backend.devToken');

    return {
      logger,
      devToken,
      usersApiEndpoint,
      tokenEndpoint,
      jwtSigningKey,
    };
  } catch (e) {
    console.log(e);
    return {};
  }
}

export async function createInterceptorRouter(
  config: ConfigReader,
  logger: winston.Logger,
): Promise<express.Router> {
  const env = makeEnv(config, logger) as InterceptorEnvironment;
  return router.createRouter(env);
}
