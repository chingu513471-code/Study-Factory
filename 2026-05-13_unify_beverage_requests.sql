-- Unify beverage data around new_beverage_requests.
-- Run this once in Supabase SQL editor before relying on preregistration beverage handoff.

ALTER TABLE public.pending_registrations
ADD COLUMN IF NOT EXISTS beverage_drinks TEXT,
ADD COLUMN IF NOT EXISTS beverage_note TEXT;

DROP POLICY IF EXISTS "Staff can insert member beverage requests" ON public.new_beverage_requests;
CREATE POLICY "Staff can insert member beverage requests" ON public.new_beverage_requests
    FOR INSERT WITH CHECK (
        auth.uid() = user_id
        OR EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role IN ('staff', 'admin')
        )
    );

DROP POLICY IF EXISTS "Staff can update member beverage requests" ON public.new_beverage_requests;
CREATE POLICY "Staff can update member beverage requests" ON public.new_beverage_requests
    FOR UPDATE USING (
        auth.uid() = user_id
        OR EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role IN ('staff', 'admin')
        )
    )
    WITH CHECK (
        auth.uid() = user_id
        OR EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role IN ('staff', 'admin')
        )
    );

-- Backfill pending preregistration beverage text from legacy option ids.
UPDATE public.pending_registrations p
SET beverage_drinks = NULLIF(array_to_string(ARRAY_REMOVE(ARRAY[
    (SELECT name FROM public.beverage_options WHERE id = p.selection_1),
    (SELECT name FROM public.beverage_options WHERE id = p.selection_2),
    (SELECT name FROM public.beverage_options WHERE id = p.selection_3)
], NULL), ', '), '')
WHERE p.beverage_drinks IS NULL
AND (p.selection_1 IS NOT NULL OR p.selection_2 IS NOT NULL OR p.selection_3 IS NOT NULL);

-- Backfill active member beverage requests from legacy selections.
INSERT INTO public.new_beverage_requests (
    user_id,
    beverage_1_choice,
    beverage_2_choice,
    beverage_2_custom,
    use_personal_tumbler,
    request_note
)
SELECT
    s.user_id,
    '안먹음',
    '기타',
    NULLIF(array_to_string(ARRAY_REMOVE(ARRAY[
        b1.name,
        b2.name,
        b3.name,
        b4.name,
        b5.name
    ], NULL), E'\n'), ''),
    false,
    NULL
FROM public.user_beverage_selections s
LEFT JOIN public.beverage_options b1 ON b1.id = s.selection_1
LEFT JOIN public.beverage_options b2 ON b2.id = s.selection_2
LEFT JOIN public.beverage_options b3 ON b3.id = s.selection_3
LEFT JOIN public.beverage_options b4 ON b4.id = s.selection_4
LEFT JOIN public.beverage_options b5 ON b5.id = s.selection_5
WHERE cardinality(ARRAY_REMOVE(ARRAY[b1.name, b2.name, b3.name, b4.name, b5.name], NULL)) > 0
ON CONFLICT (user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
    v_branch TEXT;
    v_role TEXT;
    v_seat_number INTEGER;
    v_memo TEXT;
    v_name TEXT;
    v_pending_id UUID;
    v_beverage_drinks TEXT;
    v_beverage_note TEXT;
BEGIN
    v_name := new.raw_user_meta_data->>'name';

    SELECT
        id,
        branch,
        role,
        seat_number,
        memo,
        beverage_drinks,
        beverage_note
    INTO
        v_pending_id,
        v_branch,
        v_role,
        v_seat_number,
        v_memo,
        v_beverage_drinks,
        v_beverage_note
    FROM public.pending_registrations
    WHERE name = v_name;

    INSERT INTO public.profiles (
        id,
        name,
        branch,
        role,
        email,
        seat_number
    )
    VALUES (
        new.id,
        v_name,
        COALESCE(v_branch, new.raw_user_meta_data->>'branch', '망미점'),
        COALESCE(v_role, new.raw_user_meta_data->>'role', 'member'),
        new.email,
        v_seat_number
    )
    ON CONFLICT (id) DO UPDATE
    SET
        email = EXCLUDED.email,
        branch = COALESCE(public.profiles.branch, EXCLUDED.branch),
        role = COALESCE(public.profiles.role, EXCLUDED.role),
        seat_number = COALESCE(public.profiles.seat_number, EXCLUDED.seat_number);

    IF v_beverage_drinks IS NOT NULL AND length(trim(v_beverage_drinks)) > 0 THEN
        INSERT INTO public.new_beverage_requests (
            user_id,
            beverage_1_choice,
            beverage_2_choice,
            beverage_2_custom,
            use_personal_tumbler,
            request_note
        )
        VALUES (
            new.id,
            '안먹음',
            '기타',
            replace(v_beverage_drinks, ',', E'\n'),
            false,
            NULLIF(trim(v_beverage_note), '')
        )
        ON CONFLICT (user_id) DO UPDATE
        SET
            beverage_1_choice = EXCLUDED.beverage_1_choice,
            beverage_2_choice = EXCLUDED.beverage_2_choice,
            beverage_2_custom = EXCLUDED.beverage_2_custom,
            use_personal_tumbler = EXCLUDED.use_personal_tumbler,
            request_note = EXCLUDED.request_note;
    END IF;

    IF v_memo IS NOT NULL AND v_memo != '' THEN
        INSERT INTO public.member_memos (user_id, content)
        VALUES (new.id, v_memo);
    END IF;

    IF v_pending_id IS NOT NULL THEN
        UPDATE public.pending_registrations
        SET linked_user_id = new.id
        WHERE id = v_pending_id;
    END IF;

    RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Remove legacy beverage selections after backfill.
UPDATE public.pending_registrations
SET selection_1 = NULL,
    selection_2 = NULL,
    selection_3 = NULL;

DELETE FROM public.user_beverage_selections;
DELETE FROM public.beverage_options;
