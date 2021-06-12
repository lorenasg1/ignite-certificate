import dayjs from 'dayjs';
import fs from 'fs';
import handlebars from 'handlebars';
import path from 'path';
import chromium from 'chrome-aws-lambda';
import { document } from '../utils/dynmaodbClient';
import { S3 } from 'aws-sdk';

interface ICreateCertificate {
  id: string;
  name: string;
  grade: string;
}

interface ITemplate {
  id: string;
  name: string;
  grade: string;
  date: string;
  medal: string;
}

const compile = async (data: ITemplate) => {
  const filePath = path.join(
    process.cwd(),
    'src',
    'templates',
    'certificate.hbs'
  );

  const html = fs.readFileSync(filePath, 'utf-8');

  return handlebars.compile(html)(data);
};

export const handle = async (event) => {
  const { id, name, grade } = JSON.parse(event.body) as ICreateCertificate;

  const response = await document
    .query({
      TableName: 'users_certificates',
      KeyConditionExpression: 'id = :id',
      ExpressionAttributeValues: {
        ':id': id,
      },
    })
    .promise();

  const userExists = await response.Items[0];

  if (!userExists) {
    await document
      .put({
        TableName: 'users_certificates',
        Item: {
          id,
          name,
          grade,
        },
      })
      .promise();
  }

  const medalPath = path.join(process.cwd(), 'src', 'templates', 'selo.png');
  const medal = fs.readFileSync(medalPath, 'base64');

  const data: ITemplate = {
    id,
    name,
    grade,
    medal,
    date: dayjs().format('DD/MM/YYYY'),
  };

  const content = await compile(data);

  const browser = await chromium.puppeteer.launch({
    headless: true, // default, no need to be passed
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath,
  });

  const page = await browser.newPage();

  await page.setContent(content);

  const pdf = await page.pdf({
    format: 'a4',
    landscape: true,
    path: process.env.IS_OFFLINE ? 'certificate.pdf' : null,
    printBackground: true,
    preferCSSPageSize: true,
  });

  await browser.close();

  const s3 = new S3();

  await s3
    .putObject({
      Bucket: 'igniteserverlesscertificate',
      Key: `${id}.pdf`,
      ACL: 'public-read',
      Body: pdf,
      ContentType: 'application/pdf',
    })
    .promise();

  return {
    statusCode: 201,
    body: JSON.stringify({
      message: 'Certificate created!',
      url: `https://igniteserverlesscertificate.s3.amazonaws.com/${id}.pdf`,
    }),
    headers: {
      'Content-Type': 'application/json',
    },
  };
};
