-- Members should see only aggregate totals (not other users' order details)
-- to verify minimum order amount before submitting.
CREATE OR REPLACE FUNCTION public.get_side_dish_factory_totals(target_request_date DATE)
RETURNS TABLE (
    period TEXT,
    total_amount BIGINT
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT
        periods.period,
        COALESCE(SUM(sdr.total_amount), 0)::BIGINT AS total_amount
    FROM (
        VALUES ('am'::TEXT), ('pm'::TEXT)
    ) AS periods(period)
    LEFT JOIN public.side_dish_requests sdr
        ON sdr.period = periods.period
       AND sdr.request_date = target_request_date
       AND sdr.payment_completed = true
    GROUP BY periods.period
    ORDER BY periods.period;
$$;

GRANT EXECUTE ON FUNCTION public.get_side_dish_factory_totals(DATE) TO authenticated;
