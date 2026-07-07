# skillzkit Lambda deploy artifacts

Working files for deploying the skillzkit API to AWS Lambda. The full
walkthrough lives in
[../../docs/deploy-aws-lambda.md](../../docs/deploy-aws-lambda.md);
this directory holds the IaC artifacts that doc references.

## Files

| File | Purpose |
|---|---|
| `template.yaml` | AWS SAM template — provisions Lambda + HTTP API + S3 bucket + IAM. The recommended deploy path. |
| `iam-policy.json` | Standalone IAM policy for teams deploying via CDK / Terraform / hand-rolled IaC instead of SAM. |

## Quick deploy (SAM)

```bash
cd apps/skillzkit
npm run build:lambda
sam build --template deploys/lambda/template.yaml
sam deploy --guided                  # first time
sam deploy                           # subsequent updates
```

After the deploy, the `ApiUrl` output is your team-mode API endpoint.
Point your `skillzkit init --mode team --api-url <url>` at it.

For the full walkthrough — including CDK and Terraform alternatives,
custom domain setup, monitoring, cost estimates, and troubleshooting —
see [deploy-aws-lambda.md](../../docs/deploy-aws-lambda.md).
