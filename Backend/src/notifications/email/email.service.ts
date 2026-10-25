import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { Transporter } from 'nodemailer';

@Injectable()
export class EmailService {
  private transporter?: Transporter;

  constructor(private readonly config: ConfigService) {}

  private getTransporter(): Transporter {
    if (this.transporter) {
      return this.transporter;
    }

    const host = this.config.get<string>('SMTP_HOST');
    const port = this.config.get<number>('SMTP_PORT');
    const secureValue = this.config.get<string>('SMTP_SECURE');
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASS');

    if (
      !host ||
      port === undefined ||
      !secureValue ||
      !user ||
      !pass
    ) {
      throw new ServiceUnavailableException(
        'Email delivery is not configured.',
      );
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: secureValue === 'true',
      auth: { user, pass },
    });

    return this.transporter;
  }

  async sendMail(to: string, subject: string, text: string): Promise<void> {
    const from = this.config.get<string>('SMTP_FROM');

    if (!from) {
      throw new ServiceUnavailableException(
        'Email delivery is not configured.',
      );
    }

    await this.getTransporter().sendMail({
      from,
      to,
      subject,
      text,
    });
  }
}
