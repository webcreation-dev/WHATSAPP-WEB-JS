import { Controller, Post, Body, Get, HttpException, HttpStatus, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { WhatsAppService } from './whatsapp.service';
import type { SendButtonDto, SendMessageDto, SendOTPDto } from './whatsapp.interface';

@Controller('whatsapp')
export class WhatsAppController {
  constructor(private readonly whatsAppService: WhatsAppService) { }

  @Get('status')
  getStatus() {
    return this.whatsAppService.getStatus();
  }

  @Post('send-message')
  async sendMessage(@Body() dto: SendMessageDto) {
    try {
      return await this.whatsAppService.sendMessage(dto);
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }
  }

  @Post('send-otp')
  async sendOTP(@Body() dto: SendOTPDto) {
    try {
      return await this.whatsAppService.sendOTP(dto);
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }
  }

  @Post('send-media')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads',
        filename: (req, file, cb) => {
          const randomName = Array(32)
            .fill(null)
            .map(() => Math.round(Math.random() * 16).toString(16))
            .join('');
          cb(null, `${randomName}${extname(file.originalname)}`);
        },
      }),
    }),
  )
  async sendMedia(
    @Body('to') to: string,
    @Body('caption') caption: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    try {
      if (!file) {
        throw new Error('No file uploaded');
      }

      return await this.whatsAppService.sendMedia({
        to,
        filePath: file.path,
        caption,
      });
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }
  }

  @Post('check-number')
  async checkNumber(@Body('phone') phone: string) {
    try {
      const exists = await this.whatsAppService.checkNumberExists(phone);
      return { phone, exists };
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }
  }
}