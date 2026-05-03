export function buildPantheonOpenApiSpec(options = {}) {
  const serverUrl = options.serverUrl ?? 'http://127.0.0.1:8787';

  return {
    openapi: '3.1.0',
    info: {
      title: 'Pantheon Runtime API',
      version: '1.1.0',
      description:
        'Operator and runtime endpoints for Pantheon, including observation, Ultra session state, learning ledger, and admin audit surfaces.',
    },
    servers: [{ url: serverUrl }],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'opaque-token',
        },
        BasicAuth: {
          type: 'http',
          scheme: 'basic',
        },
      },
      schemas: {
        ErrorPayload: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            details: {},
          },
        },
        MultimodalGenerateRequest: {
          type: 'object',
          required: ['modality'],
          properties: {
            modality: {
              type: 'string',
              enum: ['image', 'audio', 'video'],
            },
            personalityId: { type: 'string' },
            prompt: { type: 'string' },
            text: { type: 'string' },
            confirmed: { type: 'boolean' },
            waitForCompletion: { type: 'boolean' },
            provider: { type: 'string' },
          },
        },
        MultimodalQueueJob: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            modality: { type: 'string' },
            personalityId: { type: 'string' },
            status: { type: 'string' },
            stage: { type: 'string' },
            progressPct: { type: 'number' },
            provider: { type: 'string', nullable: true },
            createdAt: { type: 'string' },
            startedAt: { type: 'string', nullable: true },
            completedAt: { type: 'string', nullable: true },
          },
        },
        MultimodalCacheStatus: {
          type: 'object',
          properties: {
            entries: { type: 'integer' },
            cacheLimit: { type: 'integer' },
            cacheTtlMs: { type: 'integer' },
            recentKeys: {
              type: 'array',
              items: { type: 'string' },
            },
          },
        },
        PersonalityTalkRequest: {
          type: 'object',
          required: ['sourcePersonalityId', 'message'],
          properties: {
            sourcePersonalityId: { type: 'string' },
            targetPersonalityId: { type: 'string' },
            targetPersonalityIds: {
              type: 'array',
              items: { type: 'string' },
            },
            channelId: { type: 'string' },
            topic: { type: 'string' },
            message: { type: 'string' },
            facts: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  key: { type: 'string' },
                  value: { type: 'string' },
                  confidence: { type: 'number' },
                },
              },
            },
          },
        },
        SpecialistAgentExecuteRequest: {
          type: 'object',
          properties: {
            params: {
              type: 'object',
              additionalProperties: true,
            },
          },
        },
        SharedContextChannel: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            topic: { type: 'string', nullable: true },
            members: {
              type: 'array',
              items: { type: 'string' },
            },
            facts: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  key: { type: 'string' },
                  value: { type: 'string' },
                  authorId: { type: 'string', nullable: true },
                },
              },
            },
            recentMessages: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  authorId: { type: 'string' },
                  role: { type: 'string' },
                  text: { type: 'string' },
                  createdAt: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    paths: {
      '/api/admin/audit-log': {
        get: {
          summary: 'Read the operator audit trail',
          security: [{ BearerAuth: [] }],
          parameters: [
            {
              name: 'limit',
              in: 'query',
              schema: { type: 'integer', minimum: 1, maximum: 200 },
            },
            {
              name: 'type',
              in: 'query',
              schema: { type: 'string', enum: ['social'] },
            },
          ],
          '/api/agent/catalog': {
            get: {
              summary: 'List specialist agent modules',
              security: [{ BearerAuth: [] }],
              responses: {
                200: {
                  description: 'Specialist agent catalog',
                },
                401: {
                  description: 'Unauthorized',
                },
              },
            },
          },
          '/api/agent/{agentName}/{method}': {
            post: {
              summary: 'Execute a specialist agent method',
              security: [{ BearerAuth: [] }],
              parameters: [
                {
                  in: 'path',
                  name: 'agentName',
                  required: true,
                  schema: { type: 'string' },
                },
                {
                  in: 'path',
                  name: 'method',
                  required: true,
                  schema: { type: 'string' },
                },
              ],
              requestBody: {
                required: false,
                content: {
                  'application/json': {
                    schema: {
                      $ref: '#/components/schemas/SpecialistAgentExecuteRequest',
                    },
                  },
                },
              },
              responses: {
                200: {
                  description: 'Specialist agent method result',
                },
                401: {
                  description: 'Unauthorized',
                },
                404: {
                  description: 'Unknown agent or method',
                },
              },
            },
          },
          responses: {
            200: {
              description: 'Recent operator audit events',
            },
            401: { description: 'Bearer token required' },
          },
        },
      },
      '/api/atman/observe/status': {
        get: {
          summary: 'Read current observation status',
          security: [{ BearerAuth: [] }],
          parameters: [
            {
              name: 'personalityId',
              in: 'query',
              schema: { type: 'string' },
            },
          ],
          responses: {
            200: { description: 'Observation status payload' },
            401: { description: 'Bearer token required' },
          },
        },
      },
      '/api/atman/observe/control': {
        post: {
          summary: 'Enable, disable, or sample observation',
          security: [{ BearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    personalityId: { type: 'string' },
                    action: { type: 'string' },
                    scope: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Observation control result' },
            401: { description: 'Bearer token required' },
            429: { description: 'Rate limit exceeded' },
          },
        },
      },
      '/api/atman/observe/report': {
        get: {
          summary: 'Generate an observation learning report',
          security: [{ BearerAuth: [] }],
          parameters: [
            {
              name: 'personalityId',
              in: 'query',
              schema: { type: 'string' },
            },
          ],
          responses: {
            200: { description: 'Observation report payload' },
            401: { description: 'Bearer token required' },
            429: { description: 'Rate limit exceeded' },
          },
        },
      },
      '/api/atman/observe/data': {
        get: {
          summary: 'Read bounded observation metadata',
          security: [{ BearerAuth: [] }],
          parameters: [
            {
              name: 'personalityId',
              in: 'query',
              schema: { type: 'string' },
            },
          ],
          responses: {
            200: { description: 'Observation metadata snapshot' },
            401: { description: 'Bearer token required' },
          },
        },
      },
      '/api/atman/ultra-sessions': {
        get: {
          summary: 'List active Ultra sessions',
          security: [{ BearerAuth: [] }],
          responses: {
            200: { description: 'Ultra session list' },
            401: { description: 'Bearer token required' },
          },
        },
      },
      '/api/learning/atman-events': {
        get: {
          summary: 'Read persisted Atman and observation events',
          security: [{ BearerAuth: [] }],
          parameters: [
            {
              name: 'personalityId',
              in: 'query',
              schema: { type: 'string' },
            },
            {
              name: 'kind',
              in: 'query',
              schema: { type: 'string' },
            },
            {
              name: 'limit',
              in: 'query',
              schema: { type: 'integer', minimum: 1, maximum: 100 },
            },
          ],
          responses: {
            200: { description: 'Ledger-backed Atman events' },
            401: { description: 'Bearer token required' },
          },
        },
      },
      '/api/learning/state': {
        get: {
          summary: 'Read the learning ledger snapshot',
          security: [{ BearerAuth: [] }],
          responses: {
            200: { description: 'Learning ledger snapshot' },
            401: { description: 'Bearer token required' },
          },
        },
      },
      '/api/multimodal/generate': {
        post: {
          summary: 'Submit multimodal generation through the queue',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/MultimodalGenerateRequest',
                },
              },
            },
          },
          responses: {
            200: { description: 'Synchronous multimodal generation result' },
            202: { description: 'Async queue job accepted' },
            500: {
              description: 'Generation failed',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorPayload' },
                },
              },
            },
          },
        },
      },
      '/api/multimodal/queue/status': {
        get: {
          summary: 'Read multimodal queue state or a specific job',
          parameters: [
            {
              name: 'jobId',
              in: 'query',
              schema: { type: 'string' },
            },
            {
              name: 'limit',
              in: 'query',
              schema: { type: 'integer', minimum: 1, maximum: 100 },
            },
          ],
          responses: {
            200: { description: 'Queue summary or job detail' },
          },
        },
      },
      '/api/multimodal/queue/cancel': {
        post: {
          summary: 'Cancel a multimodal queue job',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['jobId'],
                  properties: {
                    jobId: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Job cancellation acknowledged' },
            404: { description: 'Job not found' },
          },
        },
      },
      '/api/multimodal/cache/status': {
        get: {
          summary: 'Read multimodal cache status',
          responses: {
            200: {
              description: 'Multimodal cache summary',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/MultimodalCacheStatus',
                  },
                },
              },
            },
          },
        },
      },
      '/api/multimodal/cache/clear': {
        post: {
          summary: 'Clear multimodal cache entries',
          requestBody: {
            required: false,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    kind: { type: 'string' },
                    personalityId: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Cache clear result' },
          },
        },
      },
      '/api/personality/talk': {
        post: {
          summary:
            'Send a social message from one personality to another or a small group',
          security: [{ BearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/PersonalityTalkRequest',
                },
              },
            },
          },
          responses: {
            200: { description: 'Social exchange completed' },
            401: { description: 'Bearer token required' },
            429: { description: 'Social message rate limit exceeded' },
          },
        },
      },
      '/api/personality/shared-context': {
        get: {
          summary: 'Read shared context channels for personality groups',
          security: [{ BearerAuth: [] }],
          parameters: [
            {
              name: 'channelId',
              in: 'query',
              schema: { type: 'string' },
            },
            {
              name: 'limit',
              in: 'query',
              schema: { type: 'integer', minimum: 1, maximum: 100 },
            },
          ],
          responses: {
            200: {
              description: 'Shared context summary or a specific channel',
            },
            401: { description: 'Bearer token required' },
          },
        },
        post: {
          summary: 'Create or update shared context for a personality group',
          security: [{ BearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    channelId: { type: 'string' },
                    members: {
                      type: 'array',
                      items: { type: 'string' },
                    },
                    topic: { type: 'string' },
                    facts: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          key: { type: 'string' },
                          value: { type: 'string' },
                          confidence: { type: 'number' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Shared context updated' },
            401: { description: 'Bearer token required' },
          },
        },
      },
      '/api/personality/relationships': {
        get: {
          summary: 'Read directed personality relationships',
          security: [{ BearerAuth: [] }],
          parameters: [
            {
              name: 'personality',
              in: 'query',
              required: true,
              schema: { type: 'string' },
            },
            {
              name: 'limit',
              in: 'query',
              schema: { type: 'integer', minimum: 1, maximum: 100 },
            },
          ],
          responses: {
            200: {
              description: 'Relationship list for the requested personality',
            },
            401: { description: 'Bearer token required' },
          },
        },
        post: {
          summary: 'Create or update a directed personality relationship',
          security: [{ BearerAuth: [] }],
          responses: {
            200: { description: 'Relationship updated' },
            401: { description: 'Bearer token required' },
          },
        },
      },
      '/api/personality/rooms': {
        get: {
          summary: 'List social rooms or read a specific room snapshot',
          security: [{ BearerAuth: [] }],
          parameters: [
            {
              name: 'roomId',
              in: 'query',
              schema: { type: 'string' },
            },
            {
              name: 'userId',
              in: 'query',
              schema: { type: 'string' },
            },
            {
              name: 'personalityId',
              in: 'query',
              schema: { type: 'string' },
            },
            {
              name: 'limit',
              in: 'query',
              schema: { type: 'integer', minimum: 1, maximum: 100 },
            },
          ],
          responses: {
            200: { description: 'Social room list or a specific room' },
            401: { description: 'Bearer token required' },
          },
        },
      },
      '/api/personality/rooms/create': {
        post: {
          summary: 'Create a social room backed by a shared context channel',
          security: [{ BearerAuth: [] }],
          responses: {
            200: { description: 'Social room created' },
            401: { description: 'Bearer token required' },
          },
        },
      },
      '/api/personality/rooms/join': {
        post: {
          summary:
            'Add a personality to a social room and optionally make it active',
          security: [{ BearerAuth: [] }],
          responses: {
            200: { description: 'Social room joined' },
            401: { description: 'Bearer token required' },
          },
        },
      },
      '/api/personality/rooms/leave': {
        post: {
          summary: 'Remove a personality from a social room',
          security: [{ BearerAuth: [] }],
          responses: {
            200: { description: 'Social room left' },
            401: { description: 'Bearer token required' },
          },
        },
      },
      '/api/personality/rooms/delete': {
        post: {
          summary: 'Archive a social room',
          security: [{ BearerAuth: [] }],
          responses: {
            200: { description: 'Social room archived' },
            401: { description: 'Bearer token required' },
          },
        },
      },
      '/api/personality/rooms/message': {
        post: {
          summary:
            'Send a room-scoped social message using the current shared context',
          security: [{ BearerAuth: [] }],
          responses: {
            200: { description: 'Social room message delivered' },
            401: { description: 'Bearer token required' },
          },
        },
      },
      '/api/personality/rooms/coalition/create': {
        post: {
          summary: 'Create a coalition inside a social room channel',
          security: [{ BearerAuth: [] }],
          responses: {
            200: { description: 'Coalition created' },
            401: { description: 'Bearer token required' },
          },
        },
      },
      '/api/personality/rooms/coalition/join': {
        post: {
          summary: 'Join an existing room coalition',
          security: [{ BearerAuth: [] }],
          responses: {
            200: { description: 'Coalition joined' },
            401: { description: 'Bearer token required' },
          },
        },
      },
      '/api/personality/rooms/coalition/leave': {
        post: {
          summary: 'Leave an existing room coalition',
          security: [{ BearerAuth: [] }],
          responses: {
            200: { description: 'Coalition left' },
            401: { description: 'Bearer token required' },
          },
        },
      },
      '/api/personality/rooms/conflict/declare': {
        post: {
          summary: 'Declare an active conflict inside a room',
          security: [{ BearerAuth: [] }],
          responses: {
            200: { description: 'Conflict declared' },
            401: { description: 'Bearer token required' },
          },
        },
      },
      '/api/personality/rooms/conflict/resolve': {
        post: {
          summary: 'Resolve an active room conflict',
          security: [{ BearerAuth: [] }],
          responses: {
            200: { description: 'Conflict resolved' },
            401: { description: 'Bearer token required' },
          },
        },
      },
      '/ws/social/room/{roomId}': {
        get: {
          summary: 'Open a live websocket stream for a social room transcript',
          security: [{ BearerAuth: [] }],
          parameters: [
            {
              name: 'roomId',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
            {
              name: 'token',
              in: 'query',
              schema: { type: 'string' },
              description:
                'Optional admin bearer token when websocket auth is enabled.',
            },
          ],
          responses: {
            101: { description: 'Websocket connection established' },
            401: { description: 'Bearer token required' },
            404: { description: 'Unknown room' },
          },
        },
      },
    },
  };
}
