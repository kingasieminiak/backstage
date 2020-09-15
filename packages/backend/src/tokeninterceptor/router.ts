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

import express from 'express';
import Router from 'express-promise-router';
import bodyParser from 'body-parser';
import { InterceptorEnvironment } from '../types';
import * as jwt from 'jsonwebtoken';
import axios from 'axios';

class TokenExchangeHandler {
  environment: InterceptorEnvironment;

  constructor(env: InterceptorEnvironment) {
    this.environment = env;
  }

  private generatePostParams(params: any): URLSearchParams {
    const postParams = new URLSearchParams();
    for (const param in params) {
      if (params.hasOwnProperty(param)) {
        postParams.append(param, params[param]);
      }
    }
    return postParams;
  }

  private async generateIdToken(accessToken: string): Promise<string> {
    return axios
      .get(this.environment.usersApiEndpoint, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      .then(response => {
        const idToken = jwt.sign(
          { email: response.data.email },
          this.environment.jwtSigningKey,
        );

        return idToken;
      });
  }

  /* eslint @typescript-eslint/camelcase: "off", no-shadow: "off" */
  private async handleAuthRequest(params: URLSearchParams) {
    return axios.post(this.environment.tokenEndpoint, params).then(response => {
      const { access_token, refresh_token } = response.data;

      return {
        access_token,
        refresh_token,
      };
    });
  }

  async handleTokenExchange(req: express.Request, res: express.Response) {
    if (req.method !== 'POST') {
      res.status(405).append('Allow', 'POST').end();
    }

    const clientId = req.body.client_id;
    const clientSecret = req.body.client_secret;
    const code = req.body.code;
    const grantType = req.body.grant_type;
    const redirectUri = req.body.redirect_uri;

    this.environment.logger.info(JSON.stringify(req.body));

    if (!clientId || !clientSecret || !grantType) {
      this.environment.logger.error(`
        Invalid Parameter: clientId: ${clientId},
        Empty clientSecret: ${typeof clientSecret === undefined},
        Empty Code: ${typeof code === undefined},
        grantType: ${grantType}, redirectUri: ${redirectUri}
      `);

      res.status(400).send('Invalid parameters for token exchange').end();
    }

    let params: URLSearchParams;

    if (grantType === 'authorization_code') {
      this.environment.logger.info(
        `${clientId}::${clientSecret}::${grantType}::${redirectUri}::${code}`,
      );

      params = this.generatePostParams({
        code: code,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: grantType,
        redirect_uri: redirectUri,
      });
    } else {
      const { refresh_token } = req.body;

      params = this.generatePostParams({
        refresh_token: refresh_token,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: grantType,
      });
    }

    try {
      const authResponse = await this.handleAuthRequest(params);
      const idToken = await this.generateIdToken(authResponse.access_token);

      res.json({
        access_token: authResponse.access_token,
        refresh_token: authResponse.refresh_token,
        id_token: idToken,
      });
    } catch (error) {
      this.environment.logger.error(error);
      res.send(500).send(error);
    }
  }

  async handleLocalTokenExchange(_: express.Request, res: express.Response) {
    try {
      const idToken = await this.generateIdToken(this.environment.devToken);

      res.json({
        access_token: this.environment.devToken,
        refresh_token: this.environment.devToken,
        id_token: idToken,
      });
    } catch (error) {
      this.environment.logger.error(error);
      res.send(500).send(error);
    }
  }
}

function createRouter(
  environment: InterceptorEnvironment,
): {
  router: express.Router;
  handler: TokenExchangeHandler;
} {
  const router = Router();

  router.use(bodyParser.json());
  router.use(bodyParser.urlencoded({ extended: false }));
  const tokenExchangeHandler = new TokenExchangeHandler(environment);

  return {
    router,
    handler: tokenExchangeHandler,
  };
}

export async function createTokenRouter(
  environment: InterceptorEnvironment,
): Promise<express.Router> {
  const { router, handler } = createRouter(environment);
  router.use(handler.handleTokenExchange.bind(handler));

  return router;
}

export async function createLocalAuthRouter(
  environment: InterceptorEnvironment,
): Promise<express.Router> {
  const { router, handler } = createRouter(environment);
  router.use(handler.handleLocalTokenExchange.bind(handler));

  return router;
}
