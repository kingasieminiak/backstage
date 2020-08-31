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
import { TokenResponse, InterceptorEnvironment } from '../types';
import * as jwt from 'jsonwebtoken';
import axios, { AxiosError } from 'axios';

class TokenExchangeHandler {
  environment: InterceptorEnvironment;

  constructor(env: InterceptorEnvironment) {
    this.environment = env;
  }
  generatePostParams(params: any): URLSearchParams {
    const postParams = new URLSearchParams();
    for (const param in params) {
      if (params.hasOwnProperty(param)) {
        postParams.append(param, params[param]);
      }
    }
    return postParams;
  }
  /* es-lint no-shadow: 0 */
  async generateIdToken(
    accessToken: string,
    refreshToken: string,
  ): Promise<TokenResponse> {
    return axios
      .get(this.environment.usersApiEndpoint, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      .then(response => {
        const idToken = jwt.sign(
          { email: response.data.email },
          this.environment.jwtSigningKey,
        );
        return {
          accessToken: accessToken,
          refreshToken: refreshToken,
          idToken: idToken,
        };
      });
  }

  /* eslint @typescript-eslint/camelcase: "off", no-shadow: "off" */
  async handleTokenExchange(req: express.Request, res: express.Response) {
    const clientId = req.body.client_id;
    const clientSecret = req.body.client_secret;
    const code = req.body.code;
    const grantType = req.body.grant_type;
    const redirectUri = req.body.redirect_uri;
    this.environment.logger.info(JSON.stringify(req.body));

    if (req.method !== 'POST') {
      res
        .status(405)
        .append('Allow', 'POST')
        .end();
    }

    if (!clientId || !clientSecret || !grantType) {
      this.environment.logger.error(`Invalid Parameter: clientId: ${clientId},
                                         Empty clientSecret: ${typeof clientSecret ===
                                           undefined},
                                         Empty Code: ${typeof code ===
                                           undefined},
                                         grantType: ${grantType}, redirectUri: ${redirectUri}`);
      res
        .status(400)
        .send('Invalid parameters for token exchange')
        .end();
    }
    if (grantType === 'authorization_code') {
      this.environment.logger.info(
        `${clientId}::${clientSecret}::${grantType}::${redirectUri}::${code}`,
      );
      const params: URLSearchParams = this.generatePostParams({
        code: code,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: grantType,
        redirect_uri: redirectUri,
      });
      axios
        .post(this.environment.tokenEndpoint, params)
        .then(response => {
          const tokenBody = response.data;
          const accessToken = tokenBody.access_token;
          const refreshToken = tokenBody.refresh_token;

          this.generateIdToken(accessToken, refreshToken)
            .then((tokenResponse: TokenResponse) => {
              const { accessToken, refreshToken, idToken } = tokenResponse;
              res.json({
                access_token: accessToken,
                refresh_token: refreshToken,
                id_token: idToken,
              });
            })
            .catch((err: AxiosError) => {
              this.environment.logger.error(
                `Generating ID token error: ${err}`,
              );
              res.send(500).send(err);
            });
        })
        .catch((err: AxiosError) => {
          this.environment.logger.error(err);
          res.sendStatus(500).send(err);
        });
    } else {
      const refresh_token = req.body.refresh_token;
      const params = this.generatePostParams({
        refresh_token: refresh_token,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: grantType,
      });

      axios
        .post(this.environment.tokenEndpoint, params)
        .then(response => {
          const tokenBody = response.data;
          const { access_token } = tokenBody;
          this.generateIdToken(access_token, refresh_token)
            .then(tokenResponse => {
              const { idToken } = tokenResponse;
              res.json({
                access_token: access_token,
                refresh_token: tokenBody.refresh_token,
                id_token: idToken,
              });
            })
            .catch(err => {
              this.environment.logger.error('error when generating ID token');
              res
                .status(500)
                .send(err)
                .end();
            });
        })
        .catch((err: AxiosError) => {
          this.environment.logger.error(
            `${JSON.stringify(err.response?.data)}`,
          );
          this.environment.logger.error(
            `${JSON.stringify(err.response?.status)}`,
          );
          res
            .status(500)
            .json(err)
            .end();
        });
    }
  }
}

export async function createRouter(
  environment: InterceptorEnvironment,
): Promise<express.Router> {
  const router = Router();

  router.use(bodyParser.json());
  router.use(bodyParser.urlencoded({ extended: false }));
  const tokenExchangeHandler = new TokenExchangeHandler(environment);

  router.use(
    tokenExchangeHandler.handleTokenExchange.bind(tokenExchangeHandler),
  );

  return router;
}
