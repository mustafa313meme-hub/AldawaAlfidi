import { Controller, Get, Global, Module, Query } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Public } from '../common/decorators';
import { AppVersionService } from './app-version.service';

class VersionQuery {
  @IsIn(['android', 'ios']) platform!: 'android' | 'ios';
  @IsString() @MaxLength(30) version!: string;
  @IsOptional() @IsString() @MaxLength(30) build?: string;
}

/** The app calls this on start (before login) to know whether it must update (SRS §107). */
@Controller('app')
export class AppVersionController {
  constructor(private versions: AppVersionService) {}

  @Public() @Get('version')
  check(@Query() q: VersionQuery) { return this.versions.check(q.platform, q.version); }
}

@Global()
@Module({ controllers: [AppVersionController], providers: [AppVersionService], exports: [AppVersionService] })
export class AppVersionModule {}
