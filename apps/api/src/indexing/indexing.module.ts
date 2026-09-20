import { Module } from '@nestjs/common';

import { IndexingService } from './indexing.service';

@Module({
  providers: [IndexingService],
  exports: [IndexingService],
})
export class IndexingModule {}
