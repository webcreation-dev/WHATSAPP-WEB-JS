/*
GET http://localhost:3323/whatsapp/status

Response:
{
  "status": "CONNECTED",
  "qr": null
}
*/

// 2. Envoyer un message simple
/*
POST http://213.136.81.100:3323/whatsapp/send-message
Content-Type: application/json

{
  "to": "22997123456",
  "message": "Bonjour! Ceci est un message test."
}

Response:
{
  "success": true,
  "messageId": "true_22997123456@c.us_3EB0...",
  "timestamp": 1234567890,
  "to": "22997123456"
}
*/

// 3. Envoyer un OTP
/*
POST http://62.72.36.30:3323/whatsapp/send-otp
Content-Type: application/json

{
  "to": "22997123456",
  "otp": "123456",
  "expiryMinutes": 5
}

Response:
{
  "success": true,
  "messageId": "true_22997123456@c.us_3EB0...",
  "timestamp": 1234567890,
  "to": "22997123456"
}
*/

// 4. Envoyer une image/fichier
/*
POST http://62.72.36.30:3323/whatsapp/send-media
Content-Type: multipart/form-data

FormData:
- to: "22997123456"
- caption: "Voici votre facture"
- file: [upload file]

Response:
{
  "success": true,
  "messageId": "true_22997123456@c.us_3EB0...",
  "timestamp": 1234567890,
  "to": "22997123456",
  "mediaType": "image/jpeg"
}
*/

// 5. Vérifier si un numéro existe
/*
POST http://62.72.36.30:3323/whatsapp/check-number
Content-Type: application/json

{
  "phone": "22997123456"
}

Response:
{
  "phone": "22997123456",
  "exists": true
}
*/