import "server-only";

import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { AWS_REGION, LAMBDA_FUNCTION_NAME } from "@/lib/config";

const s3Client = new S3Client({ region: AWS_REGION });
const lambdaClient = new LambdaClient({ region: AWS_REGION });

export function getS3Client() {
  return s3Client;
}

export async function getJsonFromS3(bucket, key) {
  const response = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = await response.Body.transformToString();
  return JSON.parse(body);
}

export async function getJsonFromS3OrNull(bucket, key) {
  try {
    return await getJsonFromS3(bucket, key);
  } catch (error) {
    const statusCode = error?.$metadata?.httpStatusCode;
    if (
      statusCode === 404 ||
      error?.name === "NoSuchKey" ||
      error?.name === "NotFound" ||
      error?.Code === "NoSuchKey"
    ) {
      return null;
    }
    throw error;
  }
}

export async function putJsonToS3(bucket, key, payload) {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify(payload, null, 2),
      ContentType: "application/json; charset=utf-8",
      CacheControl: "no-cache"
    })
  );
}

export async function objectExists(bucket, key) {
  try {
    await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (error) {
    if (error?.$metadata?.httpStatusCode === 404 || error?.name === "NotFound") {
      return false;
    }
    throw error;
  }
}

export async function invokeLambda(payload, invocationType = "RequestResponse") {
  const response = await lambdaClient.send(
    new InvokeCommand({
      FunctionName: LAMBDA_FUNCTION_NAME,
      InvocationType: invocationType,
      Payload: Buffer.from(JSON.stringify(payload))
    })
  );

  if (invocationType === "Event") {
    return {
      statusCode: response.StatusCode || 202,
      body: {
        accepted: true
      }
    };
  }

  const raw = response.Payload ? Buffer.from(response.Payload).toString("utf-8") : "";
  const data = raw ? JSON.parse(raw) : {};
  const body = typeof data.body === "string" ? JSON.parse(data.body) : data.body;

  if ((data.statusCode || 500) >= 400) {
    throw new Error(body?.error || body?.message || "Lambda invocation failed.");
  }

  return {
    statusCode: data.statusCode,
    body
  };
}
