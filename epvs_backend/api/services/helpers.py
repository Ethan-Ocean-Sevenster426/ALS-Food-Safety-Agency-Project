from decimal import Decimal
from api.models import ClientAuditLog, EggProductionVerification

LEVY_RATE = Decimal('0.018')


def _to_decimal(value):
    """Safely convert a value to Decimal, defaulting to 0."""
    try:
        return Decimal(str(value))
    except (TypeError, ValueError, ArithmeticError):
        return Decimal('0')


def calculate_totals(data):
    """
    Calculate EPV totals from a dict using JS-style field names.

    Args:
        data: dict with keys such as OpeningStock, GradedEggsPurchased,
              UngradedEggsPurchased, MarketReturns, MachineLoss, SentToPulp,
              Destroyed, SoldToTrade, SoldToStaff, SoldThroughFarmStall,
              TransferredToOtherProducers, ActualClosingStock.

    Returns:
        dict with TotalB, TotalC, TotalD, TotalE, LevyAmount,
        ClosingStock, ActualClosingStock, LossGain.
    """
    # A = Opening Stock
    total_a = _to_decimal(data.get('OpeningStock', 0))

    # B = Purchases (Graded + Ungraded)
    graded = _to_decimal(data.get('GradedEggsPurchased', 0))
    ungraded = _to_decimal(data.get('UngradedEggsPurchased', 0))
    total_b = graded + ungraded

    # C = Deductions
    market_returns = _to_decimal(data.get('MarketReturns', 0))
    machine_loss = _to_decimal(data.get('MachineLoss', 0))
    sent_to_pulp = _to_decimal(data.get('SentToPulp', 0))
    destroyed = _to_decimal(data.get('Destroyed', 0))
    total_c = market_returns + machine_loss + sent_to_pulp + destroyed

    # D = Sales
    sold_to_trade = _to_decimal(data.get('SoldToTrade', 0))
    sold_to_staff = _to_decimal(data.get('SoldToStaff', 0))
    sold_through_farm_stall = _to_decimal(data.get('SoldThroughFarmStall', 0))
    total_d = sold_to_trade + sold_to_staff + sold_through_farm_stall

    # Levy
    levy_amount = total_d * LEVY_RATE

    # E = Transfers
    total_e = _to_decimal(data.get('TransferredToOtherProducers', 0))

    # Closing Stock (Theoretical) = A + B - C - D - E
    closing_stock = total_a + total_b - total_c - total_d - total_e

    # Actual Closing Stock (provided by producer)
    actual_closing_stock = _to_decimal(data.get('ActualClosingStock', 0))

    # (Loss)/Gain = Actual - Theoretical
    loss_gain = actual_closing_stock - closing_stock

    return {
        'TotalB': float(total_b),
        'TotalC': float(total_c),
        'TotalD': float(total_d),
        'TotalE': float(total_e),
        'LevyAmount': float(levy_amount),
        'ClosingStock': float(closing_stock),
        'ActualClosingStock': float(actual_closing_stock),
        'LossGain': float(loss_gain),
    }


def log_company_audit(record_id, field_name, old_value, new_value,
                      changed_by, user_role=None):
    """
    Create a ClientAuditLog entry for a company-level field change.

    Args:
        record_id:  The ClientRecord ID (int).
        field_name: Name of the field that changed (str).
        old_value:  Previous value (str or None).
        new_value:  New value (str or None).
        changed_by: Email/identifier of the user making the change (str).
        user_role:  Optional role of the user (str or None).

    Returns:
        The created ClientAuditLog instance.
    """
    return ClientAuditLog.objects.create(
        record_id=record_id,
        field_name=field_name,
        old_value=old_value or None,
        new_value=new_value or None,
        changed_by=changed_by,
        user_role=user_role or None,
    )


def generate_reference_number(month, year):
    """
    Generate a unique EPV reference number in the format EPV-YYYY-MM-XXXX.

    The sequence number is derived from counting existing records that share
    the same year-month prefix, then incrementing by one.

    Args:
        month: Period month (int, 1-12).
        year:  Period year (int, e.g. 2026).

    Returns:
        str, e.g. 'EPV-2026-03-0001'.
    """
    prefix = f"EPV-{year}-{str(month).zfill(2)}"
    count = EggProductionVerification.objects.filter(
        reference_number__startswith=prefix
    ).count()
    seq = count + 1
    return f"{prefix}-{str(seq).zfill(4)}"
