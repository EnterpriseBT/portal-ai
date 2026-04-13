ALTER TABLE "column_definitions" ADD COLUMN "system" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "column_definitions"
SET "system" = true
WHERE "key" IN ('uuid','string_id','number_id','email','phone','url','name','description','text','code','address','status','tag','integer','decimal','percentage','currency','quantity','boolean','date','datetime','enum','json_data','array','reference','reference_array')
  AND "deleted" IS NULL;
