# Deploying skillzkit API to AWS Lambda

This guide walks through deploying the skillzkit REST API as an AWS
Lambda function backed by S3 storage. It assumes you've already
decided team mode is the right path — see
[getting-started-team-mode.md](getting-started-team-mode.md) for the
operator-vs-end-user split.

Three deploy paths covered:

1. **AWS SAM** (recommended) — a working `template.yaml` is committed
   in `deploys/lambda/`. Most teams should start here.
2. **AWS CDK** — example stack for teams already using CDK.
3. **Terraform** — example module for multi-cloud / non-AWS-native
   IaC stacks.

All three produce the same architecture:

```
            ┌──────────────────┐
            │  API Gateway     │   HTTPS, CORS, access logs
            │  (HTTP API)      │
            └────────┬─────────┘
                     │
            ┌────────▼─────────┐
            │  Lambda function │   nodejs20.x, ESM, arm64
            │  index.handler   │
            └────────┬─────────┘
                     │
            ┌────────▼─────────┐
            │  S3 bucket       │   versioned, encrypted
            │  v1/...          │
            └──────────────────┘
```

## Prerequisites

- AWS account
- AWS CLI configured (`aws configure`)
- Node.js ≥ 20 for the build step
- One of:
  - [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html) (for path 1)
  - [AWS CDK](https://docs.aws.amazon.com/cdk/v2/guide/getting-started.html) (for path 2)
  - [Terraform](https://developer.hashicorp.com/terraform/install) (for path 3)

## 1. Build the Lambda artifact

Common to all three deploy paths. From `apps/skillzkit/`:

```bash
npm install                 # one-time
npm run build:lambda
```

Produces `dist/lambda/index.mjs` (~120KB) — a single-file ESM bundle
with all dependencies inlined except:

- `@aws-sdk/*` — provided by the Lambda runtime
- `@opentui/*`, `react`, `react-reconciler` — TUI-only, never imported
  in the Lambda code path

The output is referenced by the SAM template (`CodeUri`) and by the
CDK / Terraform examples below.

## 2. Path A — Deploy with AWS SAM (recommended)

The committed template at
[`deploys/lambda/template.yaml`](../deploys/lambda/template.yaml)
provisions everything needed:

```bash
cd apps/skillzkit
npm run build:lambda

sam build --template deploys/lambda/template.yaml
sam deploy --guided           # first time
```

You'll be prompted for:

- **Stack name** (e.g., `skillzkit-prod`)
- **AWS region** (e.g., `us-east-1`)
- **CatalogBucketName** — must be globally unique S3 name
- **S3Prefix** — keep default `v1/` unless namespacing multiple deploys

Subsequent updates:

```bash
npm run build:lambda
sam build --template deploys/lambda/template.yaml
sam deploy
```

After deploy, the API Gateway URL prints in the outputs:

```
ApiUrl    https://abc123.execute-api.us-east-1.amazonaws.com
```

Use this URL as `--api-url` in `skillzkit init --mode team`.

## 3. Path B — Deploy with AWS CDK

For CDK users, the equivalent stack:

```typescript
// stacks/skillzkit-api.ts
import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigateway from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

export class SkillzkitApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const bucket = new s3.Bucket(this, "CatalogBucket", {
      versioned: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          noncurrentVersionExpiration: cdk.Duration.days(90),
        },
      ],
    });

    const fn = new lambda.Function(this, "ApiFunction", {
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: cdk.Duration.seconds(15),
      // Built by `npm run build:lambda` from apps/skillzkit/
      code: lambda.Code.fromAsset(
        "../apps/skillzkit/dist/lambda",
      ),
      handler: "index.handler",
      environment: {
        SKILLZKIT_STORAGE: `s3:${bucket.bucketName}`,
        SKILLZKIT_S3_PREFIX: "v1/",
      },
    });

    bucket.grantReadWrite(fn, "v1/*");

    const httpApi = new apigateway.HttpApi(this, "Api", {
      corsPreflight: {
        allowMethods: [apigateway.CorsHttpMethod.ANY],
        allowHeaders: ["Authorization", "Content-Type"],
        allowOrigins: ["*"],
      },
    });
    httpApi.addRoutes({
      path: "/{proxy+}",
      methods: [apigateway.HttpMethod.ANY],
      integration: new HttpLambdaIntegration("LambdaInt", fn),
    });

    new cdk.CfnOutput(this, "ApiUrl", { value: httpApi.url ?? "" });
  }
}
```

Deploy:

```bash
cdk deploy SkillzkitApi
```

## 4. Path C — Deploy with Terraform

```hcl
# main.tf
terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}

provider "aws" {
  region = var.region
}

variable "region" { default = "us-east-1" }
variable "bucket_name" {}

resource "aws_s3_bucket" "catalog" {
  bucket = var.bucket_name
}

resource "aws_s3_bucket_versioning" "catalog" {
  bucket = aws_s3_bucket.catalog.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_public_access_block" "catalog" {
  bucket                  = aws_s3_bucket.catalog.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Bundled Lambda artifact - ZIP the dist/lambda/ directory
data "archive_file" "lambda" {
  type        = "zip"
  source_dir  = "${path.module}/../apps/skillzkit/dist/lambda"
  output_path = "${path.module}/lambda.zip"
}

resource "aws_iam_role" "lambda" {
  name = "skillzkit-api-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "lambda" {
  role = aws_iam_role.lambda.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = "${aws_s3_bucket.catalog.arn}/v1/*"
      },
      {
        Effect = "Allow"
        Action = ["s3:ListBucket"]
        Resource = aws_s3_bucket.catalog.arn
        Condition = {
          StringLike = { "s3:prefix" = ["v1/*"] }
        }
      },
      {
        Effect = "Allow"
        Action = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "*"
      },
    ]
  })
}

resource "aws_lambda_function" "api" {
  function_name = "skillzkit-api"
  filename      = data.archive_file.lambda.output_path
  source_code_hash = data.archive_file.lambda.output_base64sha256
  role          = aws_iam_role.lambda.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  architectures = ["arm64"]
  memory_size   = 512
  timeout       = 15

  environment {
    variables = {
      SKILLZKIT_STORAGE   = "s3:${aws_s3_bucket.catalog.id}"
      SKILLZKIT_S3_PREFIX = "v1/"
    }
  }
}

resource "aws_apigatewayv2_api" "api" {
  name          = "skillzkit-api"
  protocol_type = "HTTP"
  cors_configuration {
    allow_methods = ["GET", "POST", "OPTIONS"]
    allow_headers = ["Authorization", "Content-Type"]
    allow_origins = ["*"]
  }
}

resource "aws_apigatewayv2_integration" "lambda" {
  api_id           = aws_apigatewayv2_api.api.id
  integration_type = "AWS_PROXY"
  integration_uri  = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "default" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "ANY /{proxy+}"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.api.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}

output "api_url" {
  value = aws_apigatewayv2_api.api.api_endpoint
}
```

Deploy:

```bash
cd apps/skillzkit
npm run build:lambda
cd ../../path/to/your/terraform/dir
terraform init
terraform apply -var="bucket_name=my-skillzkit-bucket"
```

## 5. Environment variables

Set on the Lambda function. The SAM/CDK/Terraform examples above
configure all required ones.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `SKILLZKIT_STORAGE` | yes | (none) | Backend selector. For Lambda, always `s3:<bucket-name>`. |
| `SKILLZKIT_S3_PREFIX` | optional | `v1/` | Key prefix in the bucket. Useful for multi-environment isolation. |
| `AWS_REGION` | optional | (SDK default) | Region for S3 calls. Falls back to the SDK's resolution chain. |
| `SKILLZKIT_REVIEW_AGENT` | optional | (off) | Set to `enabled` to turn on layer-3 agent review (requires additional binding configuration). |
| `PORT` | unused on Lambda | — | Only relevant for the long-running Bun server. Lambda ignores. |

## 6. IAM policy

Minimum required policy is at
[`deploys/lambda/iam-policy.json`](../deploys/lambda/iam-policy.json).
The SAM template applies an equivalent policy automatically.

Replace `<BUCKET>` and `<PREFIX>` (default `v1/`) with your values.

## 7. Cold start considerations

Typical cold start: **~300–600ms**. First-ever invocation after deploy
can take 1–2s as the module graph initializes.

Where the cold-start budget goes:

- ~50ms: Lambda runtime container initialization
- ~100ms: `await loadServerConfig()` — including dynamic import of
  `@aws-sdk/client-s3` (loaded once on cold start, reused across warm
  invocations)
- ~50ms: First S3 call (TLS handshake, DNS, etc.)

Mitigations if cold start matters for your traffic pattern:

- **Provisioned concurrency** — pin N warm instances. Costs more but
  eliminates cold starts. Configure in SAM with
  `ProvisionedConcurrencyConfig`.
- **Increase memory** — Lambda CPU scales with memory. 1024 MB has
  ~2x the CPU of 512 MB. Test with the actual workload.
- **Smaller artifact** — already 120KB, nothing further to trim.

For most teams the default cold start is fine — contributions are
human-driven (low frequency, latency-tolerant); reads are cached
client-side and served warm 95%+ of the time.

## 8. Monitoring + observability

### CloudWatch logs

The SAM template enables HTTP API access logs to CloudWatch. Lambda
itself logs to CloudWatch by default. Useful queries:

```sql
-- Recent contribute attempts (Lambda Insights)
fields @timestamp, @message
| filter @message like /POST.*contributions/
| sort @timestamp desc
| limit 50

-- Validation failures specifically
fields @timestamp, @message
| filter @message like /validation_failed/
| stats count() by bin(1h)
```

### X-Ray (optional)

Enable in the SAM template:

```yaml
ApiFunction:
  Type: AWS::Serverless::Function
  Properties:
    Tracing: Active   # adds X-Ray instrumentation
```

X-Ray traces every Lambda invocation, every S3 call, latency
breakdown. Useful when debugging slow contributions (is it the
agent review? S3? validation?).

### Custom metrics

The Hono app emits structured JSON to console; CloudWatch parses
those into log lines. To emit custom metrics, wrap responses in a
middleware that counts validation_failed, accepted, etc. and emits
EMF (CloudWatch Embedded Metric Format) JSON.

## 9. Cost estimates

Typical small-team usage (10 engineers, ~50 contributes/month, ~1000
catalog reads/day):

| Service | Monthly cost |
|---|---|
| Lambda (compute) | ~$0.05 |
| API Gateway HTTP API | ~$0.01 |
| S3 storage | ~$0.10 (catalog under 1GB) |
| S3 GET/PUT requests | ~$0.05 |
| CloudWatch Logs | ~$0.50 (30-day retention) |
| **Total** | **~$0.71/month** |

Well within AWS free tier for the first ~5 teams. Cost scales
sub-linearly with team size because reads dominate and S3 GETs are
~$0.40/M.

For high-volume deploys (>100k requests/day), monitor:

- Lambda duration × invocations
- S3 GET requests (catalog reads dominate)
- CloudWatch log ingestion (the costliest line item at scale)

## 10. End-to-end smoke test

After deploy, verify with the API URL from the output:

```bash
API=https://abc123.execute-api.us-east-1.amazonaws.com

curl $API/api/v1/health
# {"status":"ok","version":"0.0.0",...,"writable":true}

curl $API/api/v1/catalog
# {"version":1,"commands":[],"skills":[],"workflows":[]}
# Empty on a fresh deploy - contributions land via POST.
```

Then on a developer machine:

```bash
skillzkit init --mode team --email me@example.com \
  --api-url $API \
  --api-key <from-controlplane> \
  --pin <encrypts-key-at-rest>

skillzkit ui                 # browses the (empty) team catalog
```

## 11. Custom domain (optional)

To put the API behind `https://skillz.example.com`:

1. Reserve the domain in Route 53 (or your registrar)
2. Issue an ACM certificate in `us-east-1`
3. Add custom domain to the API Gateway:

```yaml
# Append to deploys/lambda/template.yaml
Api:
  Type: AWS::Serverless::HttpApi
  Properties:
    # ... existing config ...
    Domain:
      DomainName: skillz.example.com
      CertificateArn: arn:aws:acm:us-east-1:111122223333:certificate/...
      Route53:
        HostedZoneId: Z123456ABCDEF
```

## 12. Troubleshooting

### Function returns 502

Usually a cold-start timeout or unhandled init error. Check
CloudWatch logs for the function — the actual error appears at the
start of the log stream.

Common causes:

- `SKILLZKIT_STORAGE` env var unset → function init fails
- IAM policy missing S3 permission → first GET/PUT throws

### Function returns 403 on POST /api/v1/contributions

Either:

- The bearer token isn't being verified (auth verifier returns null
  for the token) — check your auth integration
- The IAM role lacks `s3:PutObject` on the prefix — check the policy

### `Could not parse v1/registry.json` error

Rare. Means S3 returned a corrupt object — usually safe to delete and
let the next put recreate (versioning will preserve the corrupt copy
for forensics):

```bash
aws s3 rm s3://my-skillzkit-bucket/v1/registry.json
```

The next contribution recreates the registry from the artifact files
on disk. (Note: the current implementation doesn't auto-rebuild from
artifact files; this would require a manual recovery script. Add a
GitHub issue if this becomes a real concern.)

### `503 Service Unavailable` on bursts

You hit Lambda concurrent execution limits. Either:

- Request a higher concurrency limit from AWS
- Add SQS in front for burst absorption (changes the API to be async)
- Enable provisioned concurrency

### Lambda artifact upload fails

The `dist/lambda/index.mjs` is too large or you're hitting AWS
upload size limits. Check:

```bash
du -sh dist/lambda/
# Should be ~120KB - if much larger, something extra got bundled.
```

If something unexpected is in the bundle, check the `external` list
in `scripts/build-lambda.ts`.

## What's next

- **[architecture.md](architecture.md)** — internal organization of
  the API server.
- **[getting-started-team-mode.md](getting-started-team-mode.md)** —
  end-user setup once the API is deployed.
- **[feature-overview.md](feature-overview.md)** — full API surface
  reference.
