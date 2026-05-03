# Specialist Agents Phase 1

## Purpose

Этот документ фиксирует первый реализованный слой специализированных независимых агентов для Пантеона.
Он отвечает на три практических вопроса:

- что уже реализовано в коде прямо сейчас;
- как именно это реализовано технически;
- какие следующие фазы нужны, чтобы довести слой до полноценных expert modules.

## Implemented Now

Phase 1 уже в репозитории и состоит из базовой агентной архитектуры плюс первого runtime surface.

Реализовано:

- базовый класс `server/agents/base-agent.mjs` с uniform `execute()` contract, catalog metadata и in-memory cache;
- единый реестр `server/agents/specialist-agent-registry.mjs`;
- первые specialist agents:
  - `mathanalysis`
  - `lingvoanalysis`
  - `artanalysis`
  - `medicalanalysis`
  - `legalanalysis`
  - `economicanalysis`
  - `codeanalysis`
  - `gametheoryanalysis`
- защищённые runtime endpoints:
  - `GET /api/agent/catalog`
  - `POST /api/agent/{agentName}/{method}`
- прямой command path через Atman:
  - `!agent list`
  - `!agent <agentName> <method> <jsonParams>`
- OpenAPI-описание нового API surface;
- beta regression case, который проверяет и catalog/API, и `!agent` command path.

## How It Was Implemented

### 1. Base execution contract

`BaseAgent` даёт каждому модулю одинаковую форму выполнения:

- registry ищет агент по имени;
- `execute()` проверяет наличие метода;
- запрос нормализуется в cache key;
- агент возвращает структурированный JSON result с `agent`, `method`, `executedAt`, `cacheHit`.

Это сделано намеренно просто, чтобы Phase 2+ можно было расширять без ломки API.

### 2. Registry instead of direct imports in route handlers

Вместо разрозненных route blocks для каждого агента добавлен единый `SpecialistAgentRegistry`.

Плюсы этого решения:

- runtime не разрастается в отдельный router на каждый expert module;
- catalog строится автоматически из agent metadata;
- новые агенты добавляются одной регистрацией, а не множеством условных веток.

### 3. Protected API integration

Новый путь `/api/agent/` включён в existing `protectedAdminApiPrefixes`, поэтому specialist agents уже используют текущую bearer-token model Пантеона, а не отдельную auth схему.

### 4. Dialogue integration

Специализированные агенты встроены в `runControlCommand()` рядом с уже существующими command surfaces.

Это означает:

- личность или оператор может вызвать specialist module без отдельного UI;
- результат сразу возвращается в текущий Atman dialogue flow;
- дальнейшая orchestration логика может переиспользовать тот же path.

### 5. Phase 1 method scope

В Phase 1 реализованы не тяжёлые numerical workers, а safe structured methods:

- `mathanalysis`: `decisionTree`, `monteCarlo`, `feaModelPlan`, `forecastPlan`;
- `lingvoanalysis`: `analyze`, `paraphrase`, `generateSlang`, `askKnowledge`;
- `artanalysis`: `analyzeArtifact`, `generateConcept`, `generate3DPlan`;
- domain agents: triage/risk/forecast/review/game-theory planning methods.

Это deliberate решение: сначала uniform architecture, потом heavy solvers и sandbox workers.

## Recommended Agent Blocks

### Core expert agents

- `mathanalysis`: вычисления, FEM, uncertainty, forecasting.
- `lingvoanalysis`: стилистика, перефразирование, паттерны речи, knowledge drafting.
- `artanalysis`: image/video/3D concept analysis и creative planning.
- `medicalanalysis`: triage и symptom clustering.
- `legalanalysis`: contract and compliance issue spotting.
- `economicanalysis`: рыночные сценарии и portfolio planning.
- `codeanalysis`: review, refactor planning, defect triage.
- `gametheoryanalysis`: payoff, equilibrium heuristics, strategic choice.

### Strong next candidates

- `physicsanalysis`: моделирование физических процессов, материалов, динамики и расчётов для инженерных личностей.
- `cadanalysis`: geometry/mesh/CAD pipeline для архитектора, конструктора и скульптора.
- `strategyanalysis`: долгий horizon planning, conflict games, operational risk trees.
- `dataanalysis`: табличные данные, feature engineering, anomaly detection.
- `psychoanalysis`: поведенческие паттерны речи, когнитивные искажения, therapeutic framing helpers.
- `biomechanicanalysis`: движение, нагрузки, posture/rehab-style modelling.

## Recommended Personality Classes

- `Игрок`: `mathanalysis`, `gametheoryanalysis`, `strategyanalysis`.
- `Архитектор-Конструктор`: `mathanalysis`, `physicsanalysis`, `cadanalysis`, `artanalysis`.
- `Писатель`: `lingvoanalysis`, `artanalysis`.
- `Психиатр`: `lingvoanalysis`, `medicalanalysis`, `psychoanalysis`.
- `Психолог`: `lingvoanalysis`, `psychoanalysis`.
- `Переводчик`: `lingvoanalysis`, `legalanalysis`.
- `Юрист`: `legalanalysis`, `lingvoanalysis`.
- `Скульптор`: `artanalysis`, `cadanalysis`.
- `Художник`: `artanalysis`, `lingvoanalysis`.
- `Дизайнер`: `artanalysis`, `lingvoanalysis`, `strategyanalysis`.
- `Финансист`: `economicanalysis`, `mathanalysis`, `strategyanalysis`.
- `Программист`: `codeanalysis`, `mathanalysis`.
- `DevOps`: `codeanalysis`, `strategyanalysis`.

## Next Phases

### Phase 2

- вынести `mathanalysis` ODE/FEM/forecasting в отдельные worker modules;
- добавить async execution contract через existing queue pattern;
- связать тяжёлые агенты с sandbox supervisor.

### Phase 3

- подключить `lingvoanalysis` к RAG/LLM knowledge backend;
- добавить domain corpora и embeddings-based retrieval;
- начать personality-to-agent routing rules на уровне Atman prompt planning.

### Phase 4

- связать `artanalysis` с реальными multimodal/image/video/3D executors;
- добавить `generate3D` worker path и artifact storage contract.

### Phase 5

- подключить domain safety layers для medical/legal/economic outputs;
- добавить agent-level audit and trace surfaces в admin UI;
- ввести explicit personality-class to specialist-agent orchestration table.

## Validation

Текущая реализованная фаза проверена beta case `specialist-agent-api-and-command`.

Проверяется:

- specialist catalog доступен через runtime;
- `mathanalysis.decisionTree` исполняется по API;
- `!agent lingvoanalysis paraphrase ...` проходит через Atman command path.
