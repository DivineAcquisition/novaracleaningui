-- Add all of Northern Virginia (Virginia Planning District 8) to the
-- active service area: Arlington, Fairfax County, Loudoun, Prince William,
-- and the independent cities of Alexandria, Fairfax, Falls Church, Manassas,
-- and Manassas Park.
--
-- 191 ZIP codes. Pricing mapped to Zones A/B/C by area:
--   A — Arlington / McLean / Great Falls / Vienna / Falls Church / Old Town
--   B — Fairfax County / Loudoun core / Alexandria
--   C — Prince William / Manassas / outer Loudoun

INSERT INTO public.service_coverage_zones (
  zip_code, city, state, county, tier, tier_label, is_active, pricing_multiplier
)
VALUES
  ('20101', 'Dulles', 'VA', 'Loudoun County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('20102', 'Dulles', 'VA', 'Loudoun County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('20103', 'Dulles', 'VA', 'Loudoun County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('20104', 'Dulles', 'VA', 'Loudoun County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('20105', 'Aldie', 'VA', 'Loudoun County', 'tier_1', 'Affluent', true, 1.1),
  ('20107', 'Arcola', 'VA', 'Loudoun County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('20108', 'Manassas', 'VA', 'Manassas City', 'tier_3', 'Working/Middle', true, 1.0),
  ('20109', 'Manassas', 'VA', 'Manassas City', 'tier_3', 'Working/Middle', true, 1.0),
  ('20110', 'Manassas', 'VA', 'Manassas City', 'tier_3', 'Working/Middle', true, 1.0),
  ('20111', 'Manassas', 'VA', 'Manassas Park City', 'tier_3', 'Working/Middle', true, 1.0),
  ('20112', 'Manassas', 'VA', 'Manassas Park City', 'tier_3', 'Working/Middle', true, 1.0),
  ('20113', 'Manassas', 'VA', 'Manassas Park City', 'tier_3', 'Working/Middle', true, 1.0),
  ('20117', 'Middleburg', 'VA', 'Loudoun County', 'tier_3', 'Working/Middle', true, 1.0),
  ('20118', 'Middleburg', 'VA', 'Loudoun County', 'tier_3', 'Working/Middle', true, 1.0),
  ('20120', 'Centreville', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('20121', 'Centreville', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('20122', 'Centreville', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('20124', 'Clifton', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('20129', 'Paeonian Springs', 'VA', 'Loudoun County', 'tier_3', 'Working/Middle', true, 1.0),
  ('20131', 'Philomont', 'VA', 'Loudoun County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('20132', 'Purcellville', 'VA', 'Loudoun County', 'tier_3', 'Working/Middle', true, 1.0),
  ('20134', 'Purcellville', 'VA', 'Loudoun County', 'tier_3', 'Working/Middle', true, 1.0),
  ('20135', 'Bluemont', 'VA', 'Loudoun County', 'tier_3', 'Working/Middle', true, 1.0),
  ('20136', 'Bristow', 'VA', 'Prince William County', 'tier_3', 'Working/Middle', true, 1.0),
  ('20141', 'Round Hill', 'VA', 'Loudoun County', 'tier_3', 'Working/Middle', true, 1.0),
  ('20142', 'Round Hill', 'VA', 'Loudoun County', 'tier_3', 'Working/Middle', true, 1.0),
  ('20143', 'Catharpin', 'VA', 'Prince William County', 'tier_3', 'Working/Middle', true, 1.0),
  ('20146', 'Ashburn', 'VA', 'Loudoun County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('20147', 'Ashburn', 'VA', 'Loudoun County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('20148', 'Ashburn', 'VA', 'Loudoun County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('20149', 'Ashburn', 'VA', 'Loudoun County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('20151', 'Chantilly', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('20152', 'Chantilly', 'VA', 'Loudoun County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('20153', 'Chantilly', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('20155', 'Gainesville', 'VA', 'Prince William County', 'tier_3', 'Working/Middle', true, 1.0),
  ('20156', 'Gainesville', 'VA', 'Prince William County', 'tier_3', 'Working/Middle', true, 1.0),
  ('20158', 'Hamilton', 'VA', 'Loudoun County', 'tier_3', 'Working/Middle', true, 1.0),
  ('20159', 'Hamilton', 'VA', 'Loudoun County', 'tier_3', 'Working/Middle', true, 1.0),
  ('20160', 'Lincoln', 'VA', 'Loudoun County', 'tier_3', 'Working/Middle', true, 1.0),
  ('20163', 'Sterling', 'VA', 'Loudoun County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('20164', 'Sterling', 'VA', 'Loudoun County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('20165', 'Sterling', 'VA', 'Loudoun County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('20166', 'Sterling', 'VA', 'Loudoun County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('20167', 'Sterling', 'VA', 'Loudoun County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('20168', 'Haymarket', 'VA', 'Prince William County', 'tier_3', 'Working/Middle', true, 1.0),
  ('20169', 'Haymarket', 'VA', 'Prince William County', 'tier_3', 'Working/Middle', true, 1.0),
  ('20170', 'Herndon', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('20171', 'Herndon', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('20172', 'Herndon', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('20175', 'Leesburg', 'VA', 'Loudoun County', 'tier_1', 'Affluent', true, 1.1),
  ('20176', 'Leesburg', 'VA', 'Loudoun County', 'tier_1', 'Affluent', true, 1.1),
  ('20177', 'Leesburg', 'VA', 'Loudoun County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('20178', 'Leesburg', 'VA', 'Loudoun County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('20180', 'Lovettsville', 'VA', 'Loudoun County', 'tier_3', 'Working/Middle', true, 1.0),
  ('20181', 'Nokesville', 'VA', 'Prince William County', 'tier_3', 'Working/Middle', true, 1.0),
  ('20182', 'Nokesville', 'VA', 'Prince William County', 'tier_3', 'Working/Middle', true, 1.0),
  ('20190', 'Reston', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('20191', 'Reston', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('20192', 'Herndon', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('20193', 'Reston', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('20194', 'Reston', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('20195', 'Reston', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('20196', 'Reston', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('20197', 'Waterford', 'VA', 'Loudoun County', 'tier_3', 'Working/Middle', true, 1.0),
  ('20199', 'Dulles', 'VA', 'Loudoun County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22003', 'Annandale', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22009', 'Burke', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22015', 'Burke', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22026', 'Dumfries', 'VA', 'Prince William County', 'tier_3', 'Working/Middle', true, 1.0),
  ('22027', 'Dunn Loring', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22030', 'Fairfax', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22031', 'Fairfax', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22032', 'Fairfax', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22033', 'Fairfax', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22034', 'Fairfax', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22035', 'Fairfax', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22036', 'Fairfax', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22037', 'Fairfax', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22038', 'Fairfax', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22039', 'Fairfax Station', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22040', 'Falls Church', 'VA', 'Falls Church City', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22041', 'Falls Church', 'VA', 'Fairfax County', 'tier_1', 'Affluent', true, 1.1),
  ('22042', 'Falls Church', 'VA', 'Fairfax County', 'tier_1', 'Affluent', true, 1.1),
  ('22043', 'Falls Church', 'VA', 'Fairfax County', 'tier_1', 'Affluent', true, 1.1),
  ('22044', 'Falls Church', 'VA', 'Fairfax County', 'tier_1', 'Affluent', true, 1.1),
  ('22046', 'Falls Church', 'VA', 'Falls Church City', 'tier_1', 'Affluent', true, 1.1),
  ('22047', 'Falls Church', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22060', 'Fort Belvoir', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22066', 'Great Falls', 'VA', 'Fairfax County', 'tier_1', 'Affluent', true, 1.1),
  ('22067', 'Greenway', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22079', 'Lorton', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22081', 'Merrifield', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22082', 'Merrifield', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22092', 'Herndon', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22093', 'Ashburn', 'VA', 'Loudoun County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22095', 'Herndon', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22096', 'Reston', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22101', 'Mc Lean', 'VA', 'Fairfax County', 'tier_1', 'Affluent', true, 1.1),
  ('22102', 'Mc Lean', 'VA', 'Fairfax County', 'tier_1', 'Affluent', true, 1.1),
  ('22103', 'West Mclean', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22106', 'Mc Lean', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22107', 'Mc Lean', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22108', 'Mc Lean', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22109', 'Mc Lean', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22116', 'Merrifield', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22118', 'Merrifield', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22119', 'Merrifield', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22120', 'Merrifield', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22121', 'Mount Vernon', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22122', 'Newington', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22124', 'Oakton', 'VA', 'Fairfax County', 'tier_1', 'Affluent', true, 1.1),
  ('22125', 'Occoquan', 'VA', 'Prince William County', 'tier_3', 'Working/Middle', true, 1.0),
  ('22134', 'Quantico', 'VA', 'Prince William County', 'tier_3', 'Working/Middle', true, 1.0),
  ('22135', 'Quantico', 'VA', 'Prince William County', 'tier_3', 'Working/Middle', true, 1.0),
  ('22150', 'Springfield', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22151', 'Springfield', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22152', 'Springfield', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22153', 'Springfield', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22156', 'Springfield', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22158', 'Springfield', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22159', 'Springfield', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22160', 'Springfield', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22161', 'Springfield', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22172', 'Triangle', 'VA', 'Prince William County', 'tier_3', 'Working/Middle', true, 1.0),
  ('22180', 'Vienna', 'VA', 'Fairfax County', 'tier_1', 'Affluent', true, 1.1),
  ('22181', 'Vienna', 'VA', 'Fairfax County', 'tier_1', 'Affluent', true, 1.1),
  ('22182', 'Vienna', 'VA', 'Fairfax County', 'tier_1', 'Affluent', true, 1.1),
  ('22183', 'Vienna', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22184', 'Vienna', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22185', 'Vienna', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22191', 'Woodbridge', 'VA', 'Prince William County', 'tier_3', 'Working/Middle', true, 1.0),
  ('22192', 'Woodbridge', 'VA', 'Prince William County', 'tier_3', 'Working/Middle', true, 1.0),
  ('22193', 'Woodbridge', 'VA', 'Prince William County', 'tier_3', 'Working/Middle', true, 1.0),
  ('22194', 'Woodbridge', 'VA', 'Prince William County', 'tier_3', 'Working/Middle', true, 1.0),
  ('22195', 'Woodbridge', 'VA', 'Prince William County', 'tier_3', 'Working/Middle', true, 1.0),
  ('22199', 'Lorton', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22201', 'Arlington', 'VA', 'Arlington County', 'tier_1', 'Affluent', true, 1.1),
  ('22202', 'Arlington', 'VA', 'Arlington County', 'tier_1', 'Affluent', true, 1.1),
  ('22203', 'Arlington', 'VA', 'Arlington County', 'tier_1', 'Affluent', true, 1.1),
  ('22204', 'Arlington', 'VA', 'Arlington County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22205', 'Arlington', 'VA', 'Arlington County', 'tier_1', 'Affluent', true, 1.1),
  ('22206', 'Arlington', 'VA', 'Arlington County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22207', 'Arlington', 'VA', 'Arlington County', 'tier_1', 'Affluent', true, 1.1),
  ('22209', 'Arlington', 'VA', 'Arlington County', 'tier_1', 'Affluent', true, 1.1),
  ('22210', 'Arlington', 'VA', 'Arlington County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22211', 'Ft Myer', 'VA', 'Arlington County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22212', 'Arlington', 'VA', 'Arlington County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22213', 'Arlington', 'VA', 'Arlington County', 'tier_1', 'Affluent', true, 1.1),
  ('22214', 'Arlington', 'VA', 'Arlington County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22215', 'Arlington', 'VA', 'Arlington County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22216', 'Arlington', 'VA', 'Arlington County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22217', 'Arlington', 'VA', 'Arlington County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22218', 'Arlington', 'VA', 'Arlington County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22219', 'Arlington', 'VA', 'Arlington County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22222', 'Arlington', 'VA', 'Arlington County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22223', 'Arlington', 'VA', 'Arlington County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22225', 'Arlington', 'VA', 'Arlington County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22226', 'Arlington', 'VA', 'Arlington County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22227', 'Arlington', 'VA', 'Arlington County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22229', 'Arlington', 'VA', 'Arlington County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22230', 'Arlington', 'VA', 'Arlington County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22234', 'Arlington', 'VA', 'Arlington County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22240', 'Arlington', 'VA', 'Arlington County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22241', 'Arlington', 'VA', 'Arlington County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22242', 'Arlington', 'VA', 'Arlington County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22243', 'Arlington', 'VA', 'Arlington County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22244', 'Arlington', 'VA', 'Arlington County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22245', 'Arlington', 'VA', 'Arlington County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22246', 'Arlington', 'VA', 'Arlington County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22301', 'Alexandria', 'VA', 'Alexandria City', 'tier_1', 'Affluent', true, 1.1),
  ('22302', 'Alexandria', 'VA', 'Alexandria City', 'tier_1', 'Affluent', true, 1.1),
  ('22303', 'Alexandria', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22304', 'Alexandria', 'VA', 'Alexandria City', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22305', 'Alexandria', 'VA', 'Alexandria City', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22306', 'Alexandria', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22307', 'Alexandria', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22308', 'Alexandria', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22309', 'Alexandria', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22310', 'Alexandria', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22311', 'Alexandria', 'VA', 'Alexandria City', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22312', 'Alexandria', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22313', 'Alexandria', 'VA', 'Alexandria City', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22314', 'Alexandria', 'VA', 'Alexandria City', 'tier_1', 'Affluent', true, 1.1),
  ('22315', 'Alexandria', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22320', 'Alexandria', 'VA', 'Alexandria City', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22321', 'Alexandria', 'VA', 'Fairfax County', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22331', 'Alexandria', 'VA', 'Alexandria City', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22332', 'Alexandria', 'VA', 'Alexandria City', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22333', 'Alexandria', 'VA', 'Alexandria City', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22334', 'Alexandria', 'VA', 'Alexandria City', 'tier_2', 'Upper-Middle', true, 1.05),
  ('22336', 'Alexandria', 'VA', 'Alexandria City', 'tier_2', 'Upper-Middle', true, 1.05)
ON CONFLICT (zip_code) DO UPDATE SET
  city = EXCLUDED.city,
  state = EXCLUDED.state,
  county = EXCLUDED.county,
  tier = EXCLUDED.tier,
  tier_label = EXCLUDED.tier_label,
  is_active = true,
  pricing_multiplier = EXCLUDED.pricing_multiplier,
  updated_at = NOW();

-- Pricing zone mappings

INSERT INTO public.pricing_zone_zips (zip, zone_id)
SELECT z.zip, pz.id
FROM (VALUES ('20105'), ('20175'), ('20176'), ('22041'), ('22042'), ('22043'), ('22044'), ('22046'), ('22066'), ('22101'), ('22102'), ('22124'), ('22180'), ('22181'), ('22182'), ('22201'), ('22202'), ('22203'), ('22205'), ('22207'), ('22209'), ('22213'), ('22301'), ('22302'), ('22314')) AS z(zip)
CROSS JOIN public.pricing_zones pz
WHERE pz.code = 'A'
ON CONFLICT (zip) DO UPDATE SET
  zone_id = EXCLUDED.zone_id;


INSERT INTO public.pricing_zone_zips (zip, zone_id)
SELECT z.zip, pz.id
FROM (VALUES ('20101'), ('20102'), ('20103'), ('20104'), ('20107'), ('20120'), ('20121'), ('20122'), ('20124'), ('20131'), ('20146'), ('20147'), ('20148'), ('20149'), ('20151'), ('20152'), ('20153'), ('20163'), ('20164'), ('20165'), ('20166'), ('20167'), ('20170'), ('20171'), ('20172'), ('20177'), ('20178'), ('20190'), ('20191'), ('20192'), ('20193'), ('20194'), ('20195'), ('20196'), ('20199'), ('22003'), ('22009'), ('22015'), ('22027'), ('22030'), ('22031'), ('22032'), ('22033'), ('22034'), ('22035'), ('22036'), ('22037'), ('22038'), ('22039'), ('22040'), ('22047'), ('22060'), ('22067'), ('22079'), ('22081'), ('22082'), ('22092'), ('22093'), ('22095'), ('22096'), ('22103'), ('22106'), ('22107'), ('22108'), ('22109'), ('22116'), ('22118'), ('22119'), ('22120'), ('22121'), ('22122'), ('22150'), ('22151'), ('22152'), ('22153'), ('22156'), ('22158'), ('22159'), ('22160'), ('22161'), ('22183'), ('22184'), ('22185'), ('22199'), ('22204'), ('22206'), ('22210'), ('22211'), ('22212'), ('22214'), ('22215'), ('22216'), ('22217'), ('22218'), ('22219'), ('22222'), ('22223'), ('22225'), ('22226'), ('22227'), ('22229'), ('22230'), ('22234'), ('22240'), ('22241'), ('22242'), ('22243'), ('22244'), ('22245'), ('22246'), ('22303'), ('22304'), ('22305'), ('22306'), ('22307'), ('22308'), ('22309'), ('22310'), ('22311'), ('22312'), ('22313'), ('22315'), ('22320'), ('22321'), ('22331'), ('22332'), ('22333'), ('22334'), ('22336')) AS z(zip)
CROSS JOIN public.pricing_zones pz
WHERE pz.code = 'B'
ON CONFLICT (zip) DO UPDATE SET
  zone_id = EXCLUDED.zone_id;


INSERT INTO public.pricing_zone_zips (zip, zone_id)
SELECT z.zip, pz.id
FROM (VALUES ('20108'), ('20109'), ('20110'), ('20111'), ('20112'), ('20113'), ('20117'), ('20118'), ('20129'), ('20132'), ('20134'), ('20135'), ('20136'), ('20141'), ('20142'), ('20143'), ('20155'), ('20156'), ('20158'), ('20159'), ('20160'), ('20168'), ('20169'), ('20180'), ('20181'), ('20182'), ('20197'), ('22026'), ('22125'), ('22134'), ('22135'), ('22172'), ('22191'), ('22192'), ('22193'), ('22194'), ('22195')) AS z(zip)
CROSS JOIN public.pricing_zones pz
WHERE pz.code = 'C'
ON CONFLICT (zip) DO UPDATE SET
  zone_id = EXCLUDED.zone_id;


UPDATE public.pricing_zones
SET
  description = 'Bethesda, Potomac, Chevy Chase, Rockville, Silver Spring, Arlington, McLean, Great Falls, Vienna, Falls Church, Alexandria Old Town',
  updated_at = NOW()
WHERE code = 'A';

UPDATE public.pricing_zones
SET
  description = 'Rest of Montgomery County, Prince George''s County, Columbia, Ellicott City, Elkridge, Laurel, Bowie, College Park, Fairfax County, Loudoun (Ashburn/Leesburg/Reston/Herndon), Alexandria',
  updated_at = NOW()
WHERE code = 'B';

UPDATE public.pricing_zones
SET
  description = 'Frederick, Hagerstown, Annapolis, Glen Burnie, Severna Park, Pasadena, Baltimore suburbs, Towson, Catonsville, Dundalk, Prince William County, Manassas, outer Loudoun',
  updated_at = NOW()
WHERE code = 'C';
