import axios from 'axios';
import FormData from 'form-data';
import logger from '../../logger';

const AIRLINK_CLOUD_URL = 'https://api.CynexCloud.xyz';

export class AirlinkCloudClient {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async uploadFile(fileStream: any, fileName: string) {
    const form = new FormData();
    form.append('file', fileStream, fileName);

    try {
      const response = await axios.post(`${AIRLINK_CLOUD_URL}/storage/upload`, form, {
        headers: {
          ...form.getHeaders(),
          'X-API-Key': this.apiKey,
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });

      return response.data;
    } catch (error) {
      logger.error('Cynex Cloud upload error:', error);
      throw error;
    }
  }

  async deleteFile(fileId: string) {
    try {
      const response = await axios.delete(`${AIRLINK_CLOUD_URL}/storage/files/${fileId}`, {
        headers: {
          'X-API-Key': this.apiKey,
        },
      });

      return response.data;
    } catch (error) {
      logger.error('Cynex Cloud delete error:', error);
      throw error;
    }
  }

  async getDownloadStream(fileId: string) {
    try {
      const response = await axios.get(`${AIRLINK_CLOUD_URL}/storage/download/${fileId}`, {
        headers: {
          'X-API-Key': this.apiKey,
        },
        responseType: 'stream',
      });

      return response;
    } catch (error) {
      logger.error('Cynex Cloud download error:', error);
      throw error;
    }
  }
}
