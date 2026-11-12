import { Controller } from '@nestjs/common';
import { api } from '@tezfiks/shared';
import { Route } from '../../common/http/route.decorator';
import { Input, type RouteInput } from '../../common/http/input.decorator';
import { CurrentUser } from '../../common/auth/current.decorators';
import type { UserPrincipal } from '../../common/auth/types';
import { CustomerService } from './customer.service';

/** api.customer.*: customer account (individual / company) and the address book. */
@Controller()
export class CustomerController {
  constructor(private readonly customers: CustomerService) {}

  @Route(api.customer.getAccount)
  getAccount(@CurrentUser() user: UserPrincipal) {
    return this.customers.getAccount(user.userId);
  }

  @Route(api.customer.upsertAccount)
  upsertAccount(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.customer.upsertAccount>) {
    return this.customers.upsertAccount(user.userId, input.body);
  }

  @Route(api.customer.listAddresses)
  listAddresses(@CurrentUser() user: UserPrincipal) {
    return this.customers.listAddresses(user.userId);
  }

  @Route(api.customer.createAddress)
  createAddress(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.customer.createAddress>) {
    return this.customers.addAddress(user.userId, input.body);
  }

  @Route(api.customer.updateAddress)
  updateAddress(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.customer.updateAddress>) {
    return this.customers.updateAddress(user.userId, input.params.id, input.body);
  }

  @Route(api.customer.deleteAddress)
  deleteAddress(@CurrentUser() user: UserPrincipal, @Input() input: RouteInput<typeof api.customer.deleteAddress>) {
    return this.customers.deleteAddress(user.userId, input.params.id);
  }
}
