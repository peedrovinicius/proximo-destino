import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { UserRole } from '@prisma/client'
import { AdminController } from '../admin/admin.controller'
import { ROLES_KEY } from '../auth/roles.decorator'
import { AdminCommercialController } from '../commercial/commercial.controller'
import { EmailAutomationController } from '../notifications/email-automation.controller'
import { PaymentConnectionAdminController } from '../payments/payment-connection.controller'
import { PrivacyController } from '../privacy/privacy.controller'
import { AdminTripsController } from '../trips/admin-trips.controller'

type ControllerClass = {
  prototype: object
}

function rolesFor(
  controller: ControllerClass,
  method: string,
) {
  const handler = (
    controller.prototype as Record<string, unknown>
  )[method]
  return Reflect.getMetadata(
    ROLES_KEY,
    handler,
  ) as UserRole[] | undefined
}

function classRoles(controller: ControllerClass) {
  return Reflect.getMetadata(
    ROLES_KEY,
    controller,
  ) as UserRole[] | undefined
}

describe('contrato RBAC das rotas administrativas', () => {
  it('mantem integracoes e privacidade exclusivas do administrador', () => {
    assert.deepEqual(classRoles(PaymentConnectionAdminController), [
      UserRole.ADMIN,
    ])
    assert.deepEqual(classRoles(EmailAutomationController), [
      UserRole.ADMIN,
    ])
    assert.deepEqual(classRoles(PrivacyController), [
      UserRole.ADMIN,
    ])
  })

  it('mantem operacoes financeiras fora do agente', () => {
    for (const method of [
      'payments',
      'reservationFinance',
      'reconcileReservationPayment',
      'registerManualPayment',
      'reverseManualPayment',
      'refundReservationPayment',
    ]) {
      const roles = rolesFor(AdminController, method) ?? []
      assert.equal(roles.includes(UserRole.AGENT), false, method)
      assert.deepEqual(roles, [UserRole.ADMIN, UserRole.FINANCE])
    }

    for (const method of [
      'listFinancePlans',
      'createFinancePlan',
      'updateInstallment',
    ]) {
      const roles = rolesFor(AdminCommercialController, method) ?? []
      assert.equal(roles.includes(UserRole.AGENT), false, method)
      assert.deepEqual(roles, [UserRole.ADMIN, UserRole.FINANCE])
    }
  })

  it('mantem alteracoes operacionais fora do financeiro', () => {
    for (const method of [
      'createReservation',
      'updateReservation',
    ]) {
      const roles = rolesFor(AdminController, method) ?? []
      assert.equal(roles.includes(UserRole.FINANCE), false, method)
      assert.deepEqual(roles, [UserRole.ADMIN, UserRole.AGENT])
    }

    for (const method of [
      'listQuotes',
      'createQuote',
      'addItem',
      'removeItem',
      'sendQuote',
      'reviseQuote',
      'listServices',
      'updateServiceStatus',
    ]) {
      const roles = rolesFor(AdminCommercialController, method) ?? []
      assert.equal(roles.includes(UserRole.FINANCE), false, method)
      assert.deepEqual(roles, [UserRole.ADMIN, UserRole.AGENT])
    }
  })

  it('mantem passageiros, cancelamento, bonus, assentos e embarque no administrador', () => {
    for (const method of [
      'reservationPassengers',
      'updateReservationPassengers',
      'cancelReservation',
      'rejectCancellationRequest',
      'applyBonus',
    ]) {
      assert.deepEqual(rolesFor(AdminController, method), [UserRole.ADMIN])
    }

    for (const method of [
      'seatMap',
      'assignSeatClient',
      'moveSeatAssignment',
      'updateSeat',
      'audit',
      'boardingList',
      'scanBoardingQr',
      'bulkUpdateBoarding',
      'updateBoarding',
      'complete',
    ]) {
      assert.deepEqual(rolesFor(AdminTripsController, method), [
        UserRole.ADMIN,
      ])
    }
  })
})
