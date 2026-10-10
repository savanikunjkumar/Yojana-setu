import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  speakRequestSchema,
  transcribeRequestSchema,
  voiceTurnRequestSchema,
  type SpeakRequest,
  type SpeakResult,
  type TranscribeRequest,
  type TranscriptionResult,
  type VoiceCapabilities,
  type VoiceTurnRequest,
  type VoiceTurnResult,
} from '@sih/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { VoiceService } from './voice.service';

@ApiTags('voice')
@Controller('voice')
export class VoiceController {
  constructor(private readonly voice: VoiceService) {}

  @Get('capabilities')
  @ApiOperation({
    summary: 'Which speech providers are actually usable',
    description:
      'The UI calls this on load so it can hide or explain the microphone rather than offering ' +
      'one that cannot work. `speechInputAvailable: false` is a normal state, not an error.',
  })
  capabilities(): VoiceCapabilities {
    return this.voice.capabilities();
  }

  @Post('transcribe')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Speech to text',
    description:
      'Audio arrives base64-encoded in JSON — clips are a few seconds long, so this avoids ' +
      'multipart plumbing. Returns a transcript the user is expected to review and correct ' +
      'before it is interpreted.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['audioBase64'],
      properties: {
        audioBase64: { type: 'string', description: 'Base64 audio from MediaRecorder' },
        mimeType: { type: 'string', example: 'audio/webm;codecs=opus' },
        language: { type: 'string', example: 'hi-IN' },
      },
    },
  })
  transcribe(
    @Body(new ZodValidationPipe(transcribeRequestSchema)) request: TranscribeRequest,
  ): Promise<TranscriptionResult> {
    return this.voice.transcribe(request);
  }

  @Post('turn')
  @HttpCode(200)
  @ApiOperation({
    summary: 'One conversational turn: interpret speech, then re-match',
    description:
      'Extracts profile fields from the transcript, merges them into the profile built so far, ' +
      'and re-runs the matcher. Fields the speaker did not clearly state stay null, which the ' +
      'matcher reports as UNKNOWN. The response carries `match.nextQuestion` — the single most ' +
      'useful thing to ask next, which drives the loop.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['transcript', 'profile'],
      properties: {
        transcript: {
          type: 'string',
          example: 'mera beta college jaa raha hai aur ghar ki income kam hai, main UP se hoon',
        },
        profile: { type: 'object', description: 'Profile accumulated so far; all-null to start' },
        language: { type: 'string', example: 'hi-IN' },
        maxFailures: { type: 'integer', example: 0 },
      },
    },
  })
  turn(
    @Body(new ZodValidationPipe(voiceTurnRequestSchema)) request: VoiceTurnRequest,
  ): Promise<VoiceTurnResult> {
    return this.voice.turn(request);
  }

  @Post('speak')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Text to speech',
    description:
      'Returns base64 audio when a speech provider is configured. `audioBase64: null` with ' +
      "provider `browser` means the client should use the browser's SpeechSynthesis, which is " +
      'the zero-cost path.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['text'],
      properties: {
        text: { type: 'string', example: 'आपकी उम्र क्या है?' },
        language: { type: 'string', example: 'hi-IN' },
      },
    },
  })
  speak(
    @Body(new ZodValidationPipe(speakRequestSchema)) request: SpeakRequest,
  ): Promise<SpeakResult> {
    return this.voice.speak(request);
  }
}
