import { Controller } from '@nestjs/common';
import { api, type Locale } from '@tezfiks/shared';
import { Route } from '../../common/http/route.decorator';
import { Input, type RouteInput } from '../../common/http/input.decorator';
import { ClientIp, CurrentAdmin, ReqLocale } from '../../common/auth/current.decorators';
import type { AdminPrincipal } from '../../common/auth/types';
import { CategoriesService } from './categories.service';
import { AdminCategoriesService } from './admin-categories.service';

@Controller()
export class CategoriesController {
  constructor(
    private readonly categories: CategoriesService,
    private readonly admin: AdminCategoriesService,
  ) {}

  @Route(api.categories.list)
  async list(@Input() input: RouteInput<typeof api.categories.list>, @ReqLocale() locale: Locale) {
    const rows = await this.categories.activeCategories(input.query?.vertical);
    return { items: rows.map((r) => this.categories.view(r, locale)) };
  }

  @Route(api.adminCategories.list)
  async adminList(@CurrentAdmin() _admin: AdminPrincipal, @ReqLocale() locale: Locale) {
    return this.admin.list(locale);
  }

  @Route(api.adminCategories.create)
  async create(
    @Input() input: RouteInput<typeof api.adminCategories.create>,
    @CurrentAdmin() admin: AdminPrincipal,
    @ClientIp() ip: string | null,
    @ReqLocale() locale: Locale,
  ) {
    return this.admin.create(input.body, { adminId: admin.adminId, ip }, locale);
  }

  @Route(api.adminCategories.update)
  async update(
    @Input() input: RouteInput<typeof api.adminCategories.update>,
    @CurrentAdmin() admin: AdminPrincipal,
    @ClientIp() ip: string | null,
    @ReqLocale() locale: Locale,
  ) {
    return this.admin.update(input.params.id, input.body, { adminId: admin.adminId, ip }, locale);
  }
}
