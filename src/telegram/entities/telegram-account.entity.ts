import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity({ name: 'telegram_accounts' })
// One live link per user and per chat; unlinked rows are kept for history.
@Index('telegram_accounts_user_live_uk', ['userId'], {
  unique: true,
  where: 'unlinked_at IS NULL',
})
@Index('telegram_accounts_chat_live_uk', ['chatId'], {
  unique: true,
  where: 'unlinked_at IS NULL',
})
export class TelegramAccount {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'telegram_accounts_pkey',
  })
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'telegram_accounts_user_id_fkey',
  })
  user: User;

  // bigint: pg returns it as a string, and we keep it that way so large
  // Telegram ids are never rounded by JS numbers.
  @Column({ name: 'chat_id', type: 'bigint' })
  chatId: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  username: string | null;

  @Column({ name: 'linked_at', type: 'timestamptz', default: () => 'now()' })
  linkedAt: Date;

  @Column({ name: 'unlinked_at', type: 'timestamptz', nullable: true })
  unlinkedAt: Date | null;
}
