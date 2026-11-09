import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { isPgError, PG_UNIQUE_VIOLATION } from '../../common/utils/db-errors';
import { PlacesService } from '../../places/services/places.service';
import {
  AreaPageResponseDto,
  CreateAreaDto,
  toAreaResponse,
  UpdateAreaDto,
} from '../dto/area.dto';
import { Area } from '../entities/area.entity';

const AREA_NOT_FOUND = 'Area not found';

@Injectable()
export class AreasService {
  constructor(
    @InjectRepository(Area) private readonly areas: Repository<Area>,
    private readonly places: PlacesService,
  ) {}

  /** Public: active areas of an active place. 404 if the place isn't visible. */
  async listByPlace(
    placeId: string,
    query: PaginationQueryDto,
  ): Promise<AreaPageResponseDto> {
    await this.places.getActivePlace(placeId);
    const [rows, total] = await this.areas.findAndCount({
      where: { placeId, isActive: true },
      order: { name: 'ASC', id: 'ASC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
    return {
      items: rows.map(toAreaResponse),
      page: query.page,
      limit: query.limit,
      total,
    };
  }

  /** Admins may add areas to inactive places, not to deleted ones. */
  async create(placeId: string, dto: CreateAreaDto): Promise<Area> {
    await this.places.getPlace(placeId);
    return this.save(
      this.areas.create({
        placeId,
        name: dto.name,
        floor: dto.floor ?? null,
        description: dto.description ?? null,
        isActive: dto.isActive ?? undefined,
      }),
    );
  }

  async update(areaId: string, dto: UpdateAreaDto): Promise<Area> {
    const area = await this.findForAdmin(areaId);
    if (dto.name !== undefined) area.name = dto.name;
    if (dto.floor !== undefined) area.floor = dto.floor;
    if (dto.description !== undefined) area.description = dto.description;
    if (dto.isActive !== undefined) area.isActive = dto.isActive;
    return this.save(area);
  }

  /** Soft delete. 409 while non-deleted seats are still assigned to the area. */
  async softDelete(areaId: string): Promise<void> {
    await this.findForAdmin(areaId);
    // shortcut: reads seats directly; areas can't import seats (seats -> areas in
    // docs/project-structure.md section 3). A soft delete skips the seats FK, so
    // without this a seat would keep pointing at a deleted area.
    const [inUse] = await this.areas.manager.query(
      'SELECT 1 FROM seats WHERE area_id = $1 AND deleted_at IS NULL LIMIT 1',
      [areaId],
    );
    if (inUse)
      throw new ConflictException(
        'Area still has seats; move or delete them first',
      );
    await this.areas.softDelete(areaId);
  }

  /** Not deleted, in a place that isn't deleted (inactive is fine for admins). */
  private async findForAdmin(areaId: string): Promise<Area> {
    const area = await this.areas
      .createQueryBuilder('area')
      .innerJoin('area.place', 'place', 'place.deletedAt IS NULL')
      .where('area.id = :areaId', { areaId })
      .getOne();
    if (!area) throw new NotFoundException(AREA_NOT_FOUND);
    return area;
  }

  private async save(area: Area): Promise<Area> {
    try {
      return await this.areas.save(area);
    } catch (err) {
      if (isPgError(err, PG_UNIQUE_VIOLATION, 'areas_place_name_uk'))
        throw new ConflictException('Area name already exists in this place');
      throw err;
    }
  }
}
