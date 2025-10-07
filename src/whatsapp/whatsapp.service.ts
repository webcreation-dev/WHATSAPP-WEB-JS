import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Client, LocalAuth, MessageMedia, Message, Buttons } from 'whatsapp-web.js';
import * as qrcode from 'qrcode-terminal';
import * as fs from 'fs';
import * as path from 'path';
import { SendButtonDto, SendMediaDto, SendMessageDto, SendOTPDto, WhatsAppStatus } from './whatsapp.interface';

@Injectable()
export class WhatsAppService implements OnModuleInit {
    private readonly logger = new Logger(WhatsAppService.name);
    private client: Client;
    private status: WhatsAppStatus = WhatsAppStatus.DISCONNECTED;
    private qrCode: string = '';
    private statusCallbacks: Array<(status: WhatsAppStatus, data?: any) => void> = [];
    private initializationTimeout: NodeJS.Timeout;

    async onModuleInit() {
        this.initialize().catch(err => {
            this.logger.error('Failed to initialize WhatsApp on module init', err);
        });
    }

    private async initialize() {
        try {
            this.logger.log('Initializing WhatsApp client...');
            this.status = WhatsAppStatus.CONNECTING;
            this.notifyStatusChange(this.status);

            if (this.initializationTimeout) {
                clearTimeout(this.initializationTimeout);
            }

            this.initializationTimeout = setTimeout(() => {
                this.logger.error('WhatsApp initialization timeout after 60 seconds');
                this.status = WhatsAppStatus.DISCONNECTED;
                this.notifyStatusChange(this.status, { error: 'Initialization timeout' });
            }, 60000);

            const puppeteerConfig: any = {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu',
                    '--disable-software-rasterizer',
                    '--disable-extensions',
                ],
            };

            if (process.platform === 'darwin' && process.env.NODE_ENV !== 'production') {
                const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
                if (fs.existsSync(chromePath)) {
                    puppeteerConfig.executablePath = chromePath;
                    this.logger.log('Using Chrome from macOS path');
                }
            }

            this.client = new Client({
                authStrategy: new LocalAuth({
                    clientId: 'whatsapp-bot',
                    dataPath: './sessions',
                }),
                puppeteer: puppeteerConfig,
                authTimeoutMs: 60000,
                qrMaxRetries: 60000,
            });

            this.setupEventHandlers();

            this.logger.log('Starting client initialization...');
            await this.client.initialize();

            clearTimeout(this.initializationTimeout);

        } catch (error) {
            this.logger.error('Failed to initialize WhatsApp client', error.stack || error);
            this.status = WhatsAppStatus.DISCONNECTED;
            this.notifyStatusChange(this.status, { error: error.message });

            if (this.initializationTimeout) {
                clearTimeout(this.initializationTimeout);
            }
        }
    }

    private setupEventHandlers() {
        this.client.on('qr', (qr) => {
            this.logger.log('QR Code received - scan with WhatsApp mobile app');
            this.qrCode = qr;
            this.status = WhatsAppStatus.QR_READY;

            qrcode.generate(qr, { small: true });

            this.notifyStatusChange(this.status, { qr });

            this.logger.log(`QR Code disponible via GET /whatsapp/status`);
        });

        this.client.on('authenticated', () => {
            this.logger.log('Client authenticated successfully');
            this.status = WhatsAppStatus.AUTHENTICATED;
            this.notifyStatusChange(this.status);
        });

        this.client.on('auth_failure', (msg) => {
            this.logger.error('Authentication failure', msg);
            this.status = WhatsAppStatus.DISCONNECTED;
            this.notifyStatusChange(this.status, { error: msg });
        });

        this.client.on('ready', () => {
            this.logger.log('✅ WhatsApp Client is ready!');
            this.status = WhatsAppStatus.CONNECTED;
            this.notifyStatusChange(this.status);
        });

        this.client.on('disconnected', (reason) => {
            this.logger.warn('Client disconnected', reason);
            this.status = WhatsAppStatus.DISCONNECTED;
            this.notifyStatusChange(this.status, { reason });

            setTimeout(() => {
                this.logger.log('Attempting to reconnect...');
                this.initialize();
            }, 5000);
        });

        this.client.on('message', async (message: Message) => {
            this.logger.log(`Message received from ${message.from}: ${message.body}`);
        });

        this.client.on('loading_screen', (percent, message) => {
            this.logger.log(`Loading: ${percent}% - ${message}`);
        });

        this.client.on('change_state', state => {
            this.logger.log(`State changed: ${state}`);
        });
    }

    private formatPhoneNumber(phone: string): string {
        let cleaned = phone.replace(/\D/g, '');

        if (!phone.includes('@c.us')) {
            return `${cleaned}@c.us`;
        }
        return phone;
    }

    async sendMessage(dto: SendMessageDto): Promise<any> {
        try {
            if (this.status !== WhatsAppStatus.CONNECTED) {
                throw new Error(`WhatsApp client not ready. Status: ${this.status}`);
            }

            const formattedNumber = this.formatPhoneNumber(dto.to);
            this.logger.log(`Sending message to ${formattedNumber}`);

            const result = await this.client.sendMessage(formattedNumber, dto.message);

            return {
                success: true,
                messageId: result.id._serialized,
                timestamp: result.timestamp,
                to: dto.to,
            };
        } catch (error) {
            this.logger.error('Failed to send message', error);
            throw new Error(`Failed to send message: ${error.message}`);
        }
    }

    async sendOTP(dto: SendOTPDto): Promise<any> {
        const expiryMinutes = dto.expiryMinutes || 5;
        const message = `🔐 Votre code de vérification est: *${dto.otp}*\n\nCe code expire dans ${expiryMinutes} minutes.\n\n⚠️ Ne partagez ce code avec personne.`;

        return this.sendMessage({
            to: dto.to,
            message,
        });
    }

    async sendMedia(dto: SendMediaDto): Promise<any> {
        try {
            if (this.status !== WhatsAppStatus.CONNECTED) {
                throw new Error(`WhatsApp client not ready. Status: ${this.status}`);
            }

            const formattedNumber = this.formatPhoneNumber(dto.to);

            if (!fs.existsSync(dto.filePath)) {
                throw new Error(`File not found: ${dto.filePath}`);
            }

            this.logger.log(`Sending media to ${formattedNumber}: ${dto.filePath}`);

            const media = MessageMedia.fromFilePath(dto.filePath);
            const result = await this.client.sendMessage(formattedNumber, media, {
                caption: dto.caption || '',
            });

            return {
                success: true,
                messageId: result.id._serialized,
                timestamp: result.timestamp,
                to: dto.to,
                mediaType: media.mimetype,
            };
        } catch (error) {
            this.logger.error('Failed to send media', error);
            throw new Error(`Failed to send media: ${error.message}`);
        }
    }

    async checkNumberExists(phone: string): Promise<boolean> {
        try {
            if (this.status !== WhatsAppStatus.CONNECTED) {
                throw new Error(`WhatsApp client not ready. Status: ${this.status}`);
            }

            const formattedNumber = this.formatPhoneNumber(phone);
            const numberId = await this.client.getNumberId(formattedNumber);

            return numberId !== null;
        } catch (error) {
            this.logger.error('Failed to check number', error);
            return false;
        }
    }

    getStatus(): { status: WhatsAppStatus; qr?: string } {
        return {
            status: this.status,
            qr: this.status === WhatsAppStatus.QR_READY ? this.qrCode : undefined,
        };
    }

    onStatusChange(callback: (status: WhatsAppStatus, data?: any) => void) {
        this.statusCallbacks.push(callback);
    }

    private notifyStatusChange(status: WhatsAppStatus, data?: any) {
        this.statusCallbacks.forEach(callback => callback(status, data));
    }

    async reinitialize() {
        this.logger.log('Manual reinitialization requested');
        if (this.client) {
            try {
                await this.client.destroy();
            } catch (error) {
                this.logger.error('Error destroying client', error);
            }
        }
        await this.initialize();
    }

    async disconnect() {
        if (this.initializationTimeout) {
            clearTimeout(this.initializationTimeout);
        }
        if (this.client) {
            await this.client.destroy();
            this.status = WhatsAppStatus.DISCONNECTED;
            this.logger.log('WhatsApp client disconnected');
        }
    }
}