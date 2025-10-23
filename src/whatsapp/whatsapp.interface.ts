export enum WhatsAppStatus {
    DISCONNECTED = 'DISCONNECTED',
    CONNECTING = 'CONNECTING',
    CONNECTED = 'CONNECTED',
    QR_READY = 'QR_READY',
    AUTHENTICATED = 'AUTHENTICATED',
}

export interface SendMessageDto {
    to: string;
    message: string;
}

export interface SendOTPDto {
    to: string;
    otp: string;
    expiryMinutes?: number;
}

export interface SendMediaDto {
    to: string;
    filePath: string;
    caption?: string;
}

export interface SendMediaUrlDto {
    to: string;
    url: string;
    caption?: string;
    filename?: string;
}

export interface SendButtonDto {
    to: string;
    message: string;
    title?: string;
    footer?: string;
    buttons: Array<{
        id: string;
        text: string;
        description?: string;
        action?: ButtonAction;
    }>;
}

export interface ButtonAction {
    type: 'reply' | 'url' | 'call' | 'webhook';
    value: string;
}

export interface SendPollDto {
    to: string;
    pollName: string;
    pollOptions: Array<{
        name: string;
        localId: number;
    }>;
    webhookUrl: string;         
    responseMessages: {          
        [key: string]: string;   
    };
}

export interface PollVoteResponse {
    voter: string;
    pollName: string;
    selectedOption: string;
    selectedOptionId: number;
    timestamp: number;
    messageId: string;
}