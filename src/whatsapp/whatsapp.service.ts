import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { Client, LocalAuth, MessageMedia, Message, Buttons, Poll, PollVote } from 'whatsapp-web.js';
import * as qrcode from 'qrcode-terminal';
import * as fs from 'fs';
import * as path from 'path';
import { SendButtonDto, SendMediaDto, SendMediaUrlDto, SendMessageDto, SendOTPDto, SendPollDto, PollVoteResponse, WhatsAppStatus, SendGroupMessageDto } from './whatsapp.interface';
import { catchError, retry, timeout } from 'rxjs/operators';
import { of, throwError } from 'rxjs';

@Injectable()
export class WhatsAppService implements OnModuleInit {
    private readonly logger = new Logger(WhatsAppService.name);
    private client: Client;
    private readonly backendBaseUrl = 'https://api.locapay.app';
    
    constructor(private readonly httpService: HttpService) {}
    private status: WhatsAppStatus = WhatsAppStatus.DISCONNECTED;
    private qrCode: string = '';
    private statusCallbacks: Array<(status: WhatsAppStatus, data?: any) => void> = [];
    private initializationTimeout: NodeJS.Timeout;
    private pollVoteCallbacks: Array<(vote: PollVoteResponse) => void> = [];

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
            this.logger.log(`Message type: ${message.type}`);
            this.logger.log(`Message hasPoll: ${!!(message as any).poll}`);
            
            // Vérifier si c'est un vote de sondage
            if (message.type === 'poll_vote' as any) {
                this.logger.log(`Poll vote message detected: ${JSON.stringify(message, null, 2)}`);
            }
            
        });

        this.client.on('loading_screen', (percent, message) => {
            this.logger.log(`Loading: ${percent}% - ${message}`);
        });

        this.client.on('change_state', state => {
            this.logger.log(`State changed: ${state}`);
        });

        // Debug: Écouter tous les événements pour voir ce qui se passe
        this.client.on('*', (event, ...args) => {
            if (event.includes('poll') || event.includes('vote')) {
                this.logger.log(`Event received: ${event}`, args);
            }
        });

        // Utiliser l'événement 'vote_update' comme dans la documentation
        this.client.on('vote_update', async (vote: PollVote) => {
            this.logger.log(`Poll vote received from ${vote.voter}`);
            this.logger.log(`Vote object: ${JSON.stringify(vote, null, 2)}`);
            
            try {
                // Récupérer le message parent pour obtenir les détails du sondage
                const parentMessage = vote.parentMessage;
                this.logger.log(`Parent message: ${JSON.stringify(parentMessage, null, 2)}`);
                
                // Récupérer l'option sélectionnée selon la documentation
                let selectedOptionName = 'Option inconnue';
                let pollName = 'Sondage';
                
                // D'après la doc: selectedOptions est un array d'objets avec name et localId
                if (vote.selectedOptions && vote.selectedOptions.length > 0) {
                    const selectedOption = vote.selectedOptions[0];
                    selectedOptionName = selectedOption.name || 'Option inconnue';
                }
                
                // Récupérer le nom du sondage depuis le message parent
                if (parentMessage && parentMessage.body) {
                    pollName = parentMessage.body;
                }
                
                const voteResponse: PollVoteResponse = {
                    voter: vote.voter,
                    pollName: pollName,
                    selectedOption: selectedOptionName,
                    selectedOptionId: 0, // On va le récupérer depuis le parentMessage
                    timestamp: vote.interractedAtTs,
                    messageId: parentMessage?.id?._serialized || 'unknown'
                };
                
                this.logger.log(`Vote details: ${JSON.stringify(voteResponse)}`);
                
                // Notifier tous les callbacks
                this.notifyPollVote(voteResponse);
                
                // Logique de réponse automatique basée sur le vote
                await this.handlePollVoteResponse(vote);
            } catch (error) {
                this.logger.error('Error processing poll vote', error);
            }
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

    async sendMediaFromUrl(dto: SendMediaUrlDto): Promise<any> {
        try {
            if (this.status !== WhatsAppStatus.CONNECTED) {
                throw new Error(`WhatsApp client not ready. Status: ${this.status}`);
            }

            const formattedNumber = this.formatPhoneNumber(dto.to);
            this.logger.log(`Sending media from URL to ${formattedNumber}: ${dto.url}`);

            const options: any = {};
            if (dto.filename) {
                options.unsafeMime = true;
            }

            const media = await MessageMedia.fromUrl(dto.url, options);
            
            if (dto.filename) {
                media.filename = dto.filename;
            }

            const result = await this.client.sendMessage(formattedNumber, media, {
                caption: dto.caption || '',
            });

            return {
                success: true,
                messageId: result.id._serialized,
                timestamp: result.timestamp,
                to: dto.to,
                mediaType: media.mimetype,
                filename: dto.filename || media.filename,
            };
        } catch (error) {
            this.logger.error('Failed to send media from URL', error);
            throw new Error(`Failed to send media from URL: ${error.message}`);
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

    /**
     * Effectue un appel HTTP avec retry logic et gestion d'erreurs robuste
     * @param method - GET ou POST
     * @param url - URL relative de l'endpoint
     * @param data - Données à envoyer (pour POST)
     * @param retries - Nombre de tentatives (par défaut 3)
     * @returns Observable avec les données ou null en cas d'erreur
     */
    private makeHttpCallWithRetry(method: 'GET' | 'POST', url: string, data?: any, retries = 3) {
        const request$ = method === 'GET'
            ? this.httpService.get(url)
            : this.httpService.post(url, data);

        return request$.pipe(
            timeout(10000), // Timeout de 10 secondes
            retry(retries), // Réessaye 3 fois en cas d'échec
            catchError(error => {
                this.logger.error(`HTTP ${method} ${url} failed after ${retries} retries`, error.message);
                // Retourner null au lieu de propager l'erreur pour éviter de crasher
                return of(null);
            })
        );
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

    async sendPoll(dto: SendPollDto): Promise<any> {
        try {
            if (this.status !== WhatsAppStatus.CONNECTED) {
                throw new Error(`WhatsApp client not ready. Status: ${this.status}`);
            }

            // Validation : vérifier que les responseMessages correspondent aux pollOptions
            const optionIds = dto.pollOptions.map(opt => opt.localId.toString());
            const responseMessageIds = Object.keys(dto.responseMessages);

            const missingResponses = optionIds.filter(id => !responseMessageIds.includes(id));
            if (missingResponses.length > 0) {
                this.logger.warn(`Missing response messages for option IDs: ${missingResponses.join(', ')}`);
                throw new Error(`Missing response messages for option IDs: ${missingResponses.join(', ')}`);
            }

            const formattedNumber = this.formatPhoneNumber(dto.to);
            this.logger.log(`Sending poll to ${formattedNumber}: ${dto.pollName}`);

            // 1. Envoyer le sondage WhatsApp
            const pollOptions = dto.pollOptions.map(option => option.name);
            const poll = new Poll(dto.pollName, pollOptions);
            const result = await this.client.sendMessage(formattedNumber, poll);

            // 2. Stocker dans le BACKEND avec retry logic
            const pollDataToSend = {
                messageId: result.id._serialized,
                pollName: dto.pollName,
                pollOptions: dto.pollOptions, // Array d'objets avec name et localId
                webhookUrl: dto.webhookUrl,
                responseMessages: dto.responseMessages,
                propertyAlertId: dto.propertyAlertId,
            };
            
            this.logger.log(`Sending to backend: ${JSON.stringify(pollDataToSend, null, 2)}`);
            
            const pollResponse = await this.makeHttpCallWithRetry('POST', `${this.backendBaseUrl}/polls`, pollDataToSend).toPromise();

            // Si le backend a échoué, on log mais on ne crash pas
            if (!pollResponse) {
                this.logger.error('Failed to store poll in backend, but WhatsApp message was sent');
            }

            this.logger.log(`Poll sent successfully`);
            return {
                success: true,
                pollId: pollResponse?.data?.pollId,
                messageId: result.id._serialized,
                timestamp: result.timestamp,
                to: dto.to,
                pollName: dto.pollName,
                pollOptions: dto.pollOptions,
                backendStored: !!pollResponse
            };
        } catch (error) {
            this.logger.error('Failed to send poll', error);
            throw new Error(`Failed to send poll: ${error.message}`);
        }
    }

    onPollVote(callback: (vote: PollVoteResponse) => void) {
        this.pollVoteCallbacks.push(callback);
    }

    private notifyPollVote(vote: PollVoteResponse) {
        this.pollVoteCallbacks.forEach(callback => callback(vote));
    }

    private async handlePollVoteResponse(vote: PollVote) {
        try {
            const messageId = vote.parentMessage.id._serialized;

            // 1. Récupérer les données du sondage avec retry
            const pollResponse = await this.makeHttpCallWithRetry('GET', `${this.backendBaseUrl}/polls/${messageId}`).toPromise();

            // Fallback : si le backend est down, on log le vote localement et on continue
            if (!pollResponse || !pollResponse.data) {
                this.logger.error(`Backend unavailable - could not retrieve poll data for ${messageId}`);
                this.logger.log(`Vote received: ${vote.voter} voted on poll ${messageId}`);
                return; // On sort proprement sans crasher
            }

            const pollData = pollResponse.data.data;

            // 2. Vérifier si déjà traité avec retry
            const alreadyProcessedResponse = await this.makeHttpCallWithRetry('GET', `${this.backendBaseUrl}/polls/votes/${messageId}/${vote.voter}`).toPromise();
            console.log('ALREADY PROCESSED RESPONSE', alreadyProcessedResponse)
            if (alreadyProcessedResponse?.data?.data?.alreadyProcessed) {
                this.logger.log(`Vote already processed for ${vote.voter}`);
                return;
            }

            // Trouver l'option sélectionnée dans le parentMessage
            const selectedOption = (vote.selectedOptions[0] as any);
            const parentPollOptions = (vote.parentMessage as any).pollOptions || [];
            const matchingOption = parentPollOptions.find((opt: any) => opt.name === selectedOption.name);
            const selectedOptionId = matchingOption?.localId || 0;

            this.logger.log(`Selected option: ${JSON.stringify(selectedOption)}`);
            this.logger.log(`Parent poll options: ${JSON.stringify(parentPollOptions)}`);
            this.logger.log(`Matching option: ${JSON.stringify(matchingOption)}`);
            this.logger.log(`Selected option ID: ${selectedOptionId}`);

            // 3. Enregistrer le vote avec retry
            const voteRecorded = await this.makeHttpCallWithRetry('POST', `${this.backendBaseUrl}/polls/votes`, {
                messageId,
                voter: vote.voter,
                selectedOption: selectedOption.name,
                selectedOptionId: selectedOptionId,
                timestamp: vote.interractedAtTs
            }).toPromise();

            if (!voteRecorded) {
                this.logger.error('Failed to record vote in backend');
            }

            // 4. Envoyer message personnalisé (même si le backend a échoué)
            const responseMessage = pollData.responseMessages?.[selectedOptionId.toString()];
            if (responseMessage) {
                try {
                    await this.sendMessage({ to: vote.voter, message: responseMessage });
                    this.logger.log(`Response message sent to ${vote.voter}`);
                } catch (error) {
                    this.logger.error(`Failed to send response message to ${vote.voter}`, error);
                }
            } else {
                this.logger.warn(`No response message configured for option ID ${selectedOptionId}`);
            }

            // 5. Appeler webhook du client avec retry
            // if (pollData.webhookUrl) {
            //     const webhookData = {
            //         pollId: pollData.pollId,
            //         voter: vote.voter,
            //         selectedOption: selectedOption.name,
            //         selectedOptionId: selectedOptionId,
            //         timestamp: vote.interractedAtTs
            //     };
                
            //     this.logger.log(`Sending webhook to ${pollData.webhookUrl}: ${JSON.stringify(webhookData, null, 2)}`);
                
            //     const webhookResponse = await this.makeHttpCallWithRetry('POST', pollData.webhookUrl, webhookData).toPromise();

            //     if (!webhookResponse) {
            //         this.logger.error(`Failed to call webhook ${pollData.webhookUrl}`);
            //     }
            // }
        } catch (error) {
            this.logger.error('Error handling poll vote response', error);
            // On ne throw pas l'erreur pour éviter de crasher le service
        }
    }

    async sendGroupMessage(dto: SendGroupMessageDto): Promise<any> {
        try {
          if (this.status !== WhatsAppStatus.CONNECTED) {
            throw new Error(`WhatsApp client not ready. Status: ${this.status}`);
          }
      
          // Le groupId doit être au format: 123456789-987654321@g.us
          const groupId = dto.groupId.includes('@g.us') 
            ? dto.groupId 
            : `${dto.groupId}@g.us`;
      
          this.logger.log(`Sending message to group ${groupId}`);
      
          const result = await this.client.sendMessage(groupId, dto.message);
      
          return {
            success: true,
            messageId: result.id._serialized,
            timestamp: result.timestamp,
            groupId: dto.groupId,
          };
        } catch (error) {
          this.logger.error('Failed to send group message', error);
          throw new Error(`Failed to send group message: ${error.message}`);
        }
      }

      async getGroups(): Promise<any> {
        try {
          if (this.status !== WhatsAppStatus.CONNECTED) {
            throw new Error(`WhatsApp client not ready. Status: ${this.status}`);
          }
      
          this.logger.log('Fetching all groups...');
      
          // Récupérer tous les chats
          const chats = await this.client.getChats();
          
          // Filtrer uniquement les groupes
          const groups = chats.filter(chat => chat.isGroup);
      
          // Formater les données pour le retour
          const groupsList = groups.map(group => ({
            id: group.id._serialized,
            name: group.name,
            participantsCount: (group as any).participants?.length || 0,
            isReadOnly: group.isReadOnly,
            timestamp: group.timestamp,
          }));
      
          return {
            success: true,
            count: groupsList.length,
            groups: groupsList,
          };
        } catch (error) {
          this.logger.error('Failed to fetch groups', error);
          throw new Error(`Failed to fetch groups: ${error.message}`);
        }
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