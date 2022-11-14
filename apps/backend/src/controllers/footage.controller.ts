import { v4 as uuidv4 } from 'uuid';
import { spawn } from 'child_process'
import ytdl from 'ytdl-core';
import * as fs from 'fs';
import {
  Footage,
  FootageZod,
  FootageZodSchema,
  FootageUpdateInputSchema,
  FootageCreateInputSchema,
  FootageRetrieveSchema,
  FootageRetrieveZod,
} from '../models/footage.interface';
import { Clip, ClipZodSchema } from '../models/clip.interface';
import { createHttpError, defaultEndpointsFactory, z } from 'express-zod-api';

/**
 * POST /footage
 * @summary Endpoint to create new Footage document based on submission from web form.
 * @param {string} id.form.required - The User's Discord ID - application/x-www-form-urlencoded
 * @param {string} username.form.required - The User's Discord name - application/x-www-form-urlencoded
 * @param {string} url.form.required - The YouTube URL with capture footage - application/x-www-form-urlencoded
 * @return {FootageDocument} 200 - Success response returns created Footage document.
 * @return 422 - A required form item is missing (i.e.: id, username, url).
 * @return 406 - The YouTube URL is not to an acceptable.
 * @return 400 - The YouTube URL has already been submitted.
 * @return 500 - Some internal error
 */
export const createFootage = defaultEndpointsFactory.build({
  method: 'post',
  input: FootageCreateInputSchema,
  output: FootageZodSchema,
  handler: async ({ input: { id, username, url }, options, logger }) => {
    console.log('???');
    logger.info(`handler init ${url}`);

    const existingFootage = await Footage.findOne({ youtubeUrl: url });

    if (existingFootage) {
      throw createHttpError(400, `URL ${url} has already been submitted.`);
    }

    try {
      const footageId = uuidv4();

      // Validate that the URL contains a video that can be downloaded.
      const details = await ytdl.getInfo(url);

      await new Promise(async (resolve, reject) => {
        const fileWriter = fs
          .createWriteStream(`${footageId}.mp4`)
          .on('finish', () => {
            resolve({})
          })

        // Download video and save as a local MP4 to be used for processing.
        await ytdl(url).pipe(fileWriter);
      }).then(() => {
        const python = spawn(
          'python3',
          ['autoClip.py', `${footageId}.mp4`, 'clips'],
          { shell: true, stdio: 'inherit' },
        );

        python.stdout.on('error', function (data) {
          console.log('Pipe data from python script ...', data);
        });

        python.stdout.on('data', function (data) {
          console.log('Pipe data from python script ...', data);
        });

        python.on('close', async (code) => {
          console.log(`child process close all stdio with code ${code}`);

          const footageInput: FootageZod = {
            uuid: footageId,
            discordId: id,
            username,
            youtubeUrl: url,
            isCsgoFootage: false,
            isAnalyzed: false,
          };

          await Footage.create(footageInput);

          return footageInput;
        });
      })
    } catch (error) {
      if (error instanceof Error) {
        // probably don't want to do this in prod
        throw createHttpError(406, error.message);
      }

      throw createHttpError(500, 'Something went wrong processing the video.');
    }
  },
});

/**
 * GET /footage/:uuid
 * @summary Endpoint to get a specific Footage document.
 * @return {FootageDocument} 200 - Success response returns the Footage document.
 * @return 404 - Footage with UUID could not be found.
 */
export const getFootage = defaultEndpointsFactory.build({
  method: 'get',
  input: z.object({
    uuid: z.string().uuid().optional(),
  }),
  // ignores the output error below uncomment if you want to try and fix it
  // the error doesn't cause any problems with operations.
  output: FootageRetrieveSchema,
  handler: async ({ input: { uuid }, options, logger }) => {
    // all footage returns
    const footageResult: any[] = [];
    if (uuid) {
      const footage = await Footage.findOne({ uuid });
      if (footage === null) {
        console.log('error');
        throw createHttpError(
          404,
          'No footage document with the UUID provided could be found.',
        );
      }
      footageResult.push(footage);
    } else {
      const allFootage = await Footage.find().sort('-createdAt').exec();
      if (allFootage == null) {
        throw createHttpError(404, 'No footage documents could be found.');
      }
      allFootage.forEach((doc, index) => {
        footageResult.push(doc);
      });
    }
    return { footage: footageResult };
  },
});

/**
 * GET /footage/user/:id
 * @summary Endpoint to get all Footage documents associated to a user.
 * @return {array<FootageDocument>} 200 - Success response returns the Footage document.
 * @return 404 - No Footage found with the provided User ID.
 */
export const getUserFootage = defaultEndpointsFactory.build({
  method: 'get',
  input: z.object({
    // had to change to string because the param is sent as a string not as a number for some reason.
    discordId: z.string(),
  }),
  output: z.object({
    footage: z.array(FootageZodSchema),
  }),
  handler: async ({ input: { discordId }, options, logger }) => {
    const footage = await Footage.find({ discordId });

    if (footage.length === 0)
      throw createHttpError(404, 'No footage found with the provided User ID.');

    return { footage };
  },
});

/**
 * GET /footage/clips/:uuid
 * @summary Endpoint to get all Clip documents associated to a specific Footage UUID.
 * @return {array<ClipDocument>} 200 - Success response returns the Footage document.
 * @return 404 - No Clips found for the provided Footage UUID.
 */
export const getFootageClips = defaultEndpointsFactory.build({
  method: 'get',
  input: z.object({
    uuid: z.string().uuid(),
  }),
  output: z.object({
    clips: z.array(ClipZodSchema),
  }),
  handler: async ({ input: { uuid }, options, logger }) => {
    const clips = await Clip.find({ footage: uuid });

    if (clips.length === 0)
      throw createHttpError(
        404,
        `No clips found for footage with uuid "${uuid}"`,
      );

    return { clips };
  },
});

/**
 * PATCH /footage/:uuid
 * @summary Endpoint to update a specific Footage document.
 * @return {FootageDocument} 200 - Success response returns the Footage document updated and a message.
 * @return {string} 200 - Success response returns the Footage document updated and a message.
 * @return 400 - Fields isCsgoFootage & isAnalyzed were not provided.
 * @return 406 - One of the params (UUID, isCsgoFootage or isAnalyzed) was not provided.
 * @return 412 - No document with the provided UUID was found.
 * @return 418 - An error occured while attempting to update the FootageDocument.
 * @return 500 - Some internal error
 */
export const updateFootage = defaultEndpointsFactory.build({
  method: 'patch',
  input: FootageUpdateInputSchema,
  output: FootageZodSchema,
  handler: async ({
    input: { uuid, isAnalyzed, isCsgoFootage },
    options,
    logger,
  }) => {
    const updatedFootage = {
      isAnalyzed,
      isCsgoFootage,
    };

    const filter = { uuid: uuid };
    try {
      const result = await Footage.findOneAndUpdate(filter, updatedFootage);
      if (!result)
        throw createHttpError(412, 'No document with that UUID was found.');

      return result;
    } catch (error) {
      if (error instanceof Error) {
        // probably don't want to do this in prod
        throw createHttpError(418, error.message);
      }

      throw createHttpError(500, 'Something went wrong processing the video.');
    }
  },
});

/**
 * DELETE /footage/:uuid
 * @summary Endpoint to delete a specific Footage document.
 * @return 200 - Successfully deleted Footage document based on UUID.
 * @return 404 - Footage UUID not found.
 */
export const deleteFootage = defaultEndpointsFactory.build({
  method: 'delete',
  input: z.object({
    uuid: z.string().uuid(),
  }),
  output: z.object({
    message: z.string(),
  }),
  handler: async ({ input: { uuid }, options, logger }) => {
    const deleteResult = await Footage.deleteOne({ uuid: uuid });

    if (deleteResult.deletedCount === 0)
      throw createHttpError(404, `Footage with uuid "${uuid}" not found.`);

    return { message: 'Footage deleted successfully.' };
  },
});
