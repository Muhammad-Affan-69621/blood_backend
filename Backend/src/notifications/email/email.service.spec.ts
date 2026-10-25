jest.mock('nodemailer', () => ({
  __esModule: true,
  default: {
    createTransport: jest.fn(),
  },
}));

import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';

import { EmailService } from './email.service';

describe('EmailService', () => {
  let service: EmailService;
  let config: { get: jest.Mock };
  let sendMail: jest.Mock;

  const settings: Record<string, string | number | undefined> = {
    SMTP_HOST: 'smtp.example.com',
    SMTP_PORT: 587,
    SMTP_SECURE: 'false',
    SMTP_USER: 'mailer@example.com',
    SMTP_PASS: 'test-placeholder-only',
    SMTP_FROM: 'noreply@example.com',
  };

  beforeEach(() => {
    jest.clearAllMocks();

    config = {
      get: jest.fn((key: string) => settings[key]),
    };

    sendMail = jest.fn().mockResolvedValue({ messageId: 'mock-message-id' });

    (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });

    service = new EmailService(config as unknown as ConfigService);
  });

  it('rejects sending when SMTP configuration is missing', async () => {
    config.get.mockReturnValue(undefined);

    await expect(
      service.sendMail('recipient@example.com', 'Test', 'Test message'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(nodemailer.createTransport).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('sends the expected message using the configured SMTP transport', async () => {
    await service.sendMail(
      'recipient@example.com',
      'Password reset',
      'Use the reset link to continue.',
    );

    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      auth: {
        user: 'mailer@example.com',
        pass: 'test-placeholder-only',
      },
    });

    expect(sendMail).toHaveBeenCalledWith({
      from: 'noreply@example.com',
      to: 'recipient@example.com',
      subject: 'Password reset',
      text: 'Use the reset link to continue.',
    });
  });

  it('rejects sending when SMTP_FROM is missing', async () => {
    settings.SMTP_FROM = undefined;

    await expect(
      service.sendMail('recipient@example.com', 'Test', 'Test message'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(nodemailer.createTransport).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });
});
