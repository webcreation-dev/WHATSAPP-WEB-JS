import { Module } from '@nestjs/common';
import { WhatsAppModule } from './whatsapp/whatsapp.module';

@Module({
  imports: [WhatsAppModule],
  controllers: [],
  providers: [],
})
export class AppModule { }
