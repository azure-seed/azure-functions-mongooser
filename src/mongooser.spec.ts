// libs
import { get, getOr } from 'lodash/fp';
import * as mongoose from 'mongoose';
import { prop, Ref } from 'typegoose';
import { Context, HttpMethod, HttpRequest, HttpResponse, HttpStatusCode } from 'azure-functions-ts-essentials';

// module
import { Activatable } from './models/activatable';
import { BaseDocument } from './models/base-document';
import { deactivateOne, getMany, getOne, insertMany, updateOne } from './mongooser';
import { clearCollection, connect, parseFields, parsePopulation, parseQuery, parseSort } from './util';

const CONNSTRING = 'mongodb://localhost:27017/test_collection';
const MOCK_ITEM = 'mockItem';
const MOCK_CHILD_ITEM = 'mockChildItem';
const MOCK_WRATHCHILD_ITEM = 'mockWrathchildItem';
const MOCK_LEAF_ITEM = 'mockLeafItem';

let TEST_ID: string;
const INITIAL_ITEMS = [
  {
    code: 'CODE',
    name: 'name',
    child: undefined,
    wrathchild: undefined
  },
  {
    code: 'ANOTHER CODE',
    name: 'another name',
    child: undefined,
    wrathchild: undefined,
    isActive: false
  }
];
const POST_VALUE = {
  code: 'NEW CODE',
  name: 'new name',
  child: undefined,
  wrathchild: undefined
};
const PATCH_VALUE = {
  code: 'SOME CODE'
};

const INITIAL_CHILD = {
  name: 'name',
  wrathchild1: undefined,
  wrathchild2: undefined
};
const INITIAL_WRATHCHILD = {
  name: 'name',
  leaf: undefined
};
const INITIAL_LEAF = {
  name: 'name',
  bananas: 1
};

const INVALID_ID = '13a25b2ec826e1264865415a';
const INVALID_VALUE = {
  invalid: true
};

class MockLeafItem extends BaseDocument {
  @prop()
  bananas: number;
}

class MockWrathchildItem extends BaseDocument {
  @prop()
  name?: string;

  @prop({ ref: MockLeafItem })
  leaf?: Ref<MockLeafItem>;
}

class MockChildItem extends BaseDocument {
  @prop()
  name?: string;

  @prop({ ref: MockWrathchildItem })
  wrathchild1?: Ref<MockWrathchildItem>;

  @prop({ ref: MockWrathchildItem })
  wrathchild2?: Ref<MockWrathchildItem>;
}

class MockItem extends BaseDocument implements Activatable {
  @prop({ index: true, unique: true, required: true })
  code: string;

  @prop({ index: true })
  name?: string;

  @prop({ ref: MockChildItem })
  child?: Ref<MockChildItem>;

  @prop({ ref: MockWrathchildItem })
  wrathchild?: Ref<MockWrathchildItem>;

  @prop({ default: true })
  isActive: boolean;
}

const mockItemModel = new MockItem().getModelForClass(MockItem, {
  schemaOptions: {
    collection: MOCK_ITEM
  }
});
const mockChildModel = new MockChildItem().getModelForClass(MockChildItem, {
  schemaOptions: {
    collection: MOCK_CHILD_ITEM
  }
});
const mockWrathchildModel = new MockWrathchildItem().getModelForClass(MockWrathchildItem, {
  schemaOptions: {
    collection: MOCK_WRATHCHILD_ITEM
  }
});
const mockLeafModel = new MockLeafItem().getModelForClass(MockLeafItem, {
  schemaOptions: {
    collection: MOCK_LEAF_ITEM
  }
});

const mock = (context: Context, req: HttpRequest) => {
  (mongoose as any).Promise = global.Promise;

  connect(mongoose, CONNSTRING)
    .then(() => {
      const id = get('id')(req.params);

      switch (req.method) {
        case HttpMethod.Get:
          const criteria = parseQuery(get('q')(req.query));
          const projection = parseFields(get('fields')(req.query));
          const population = parsePopulation(get('populate')(req.query));
          const page = get('page')(req.query);
          const perPage = get('per_page')(req.query);
          const sort = parseSort(get('sort')(req.query));
          const showInactive = get('showInactive')(req.query);

          return id
            ? getOne<MockItem>(id, projection, population)(mockItemModel)
            : getMany<MockItem>(criteria, projection, population, page, perPage, sort, showInactive)(mockItemModel);
        case HttpMethod.Post:
          return insertMany<MockItem>(req)(mockItemModel);
        case HttpMethod.Patch:
          return updateOne<MockItem>(req, id)(mockItemModel);
        case HttpMethod.Delete:
          return deactivateOne<MockItem>(id)(mockItemModel);
        default:
          return Promise.resolve({
            status: HttpStatusCode.MethodNotAllowed,
            body: {
              error: {
                type: 'not_supported',
                message: `Method ${req.method} not supported.`
              }
            }
          });
      }
    })
    .then(res => {
      mongoose.connection.close()
        .then(() => context.done(undefined, res));
    });
};

describe('@azure-seed/azure-functions-mongooser', () => {
  beforeAll(async () => {
    (mongoose as any).Promise = global.Promise;

    await connect(mongoose, CONNSTRING);

    const leaves = await mockLeafModel.insertMany(INITIAL_LEAF);
    INITIAL_WRATHCHILD.leaf = leaves[0].id;

    const wrathchildren = await mockWrathchildModel.insertMany(INITIAL_WRATHCHILD);
    const wrathchildId = wrathchildren[0]._id;
    INITIAL_CHILD.wrathchild1 = wrathchildren[0]._id;
    INITIAL_CHILD.wrathchild2 = wrathchildren[0]._id;

    const children = await mockChildModel.insertMany(INITIAL_CHILD);
    const childId = children[0]._id;
    INITIAL_ITEMS[0].child = childId;
    INITIAL_ITEMS[0].wrathchild = wrathchildId;
    INITIAL_ITEMS[1].child = childId;
    INITIAL_ITEMS[1].wrathchild = wrathchildId;
    POST_VALUE.child = childId;
    POST_VALUE.wrathchild = wrathchildId;

    await mockItemModel.insertMany(INITIAL_ITEMS);
  });

  afterAll(async () => {
    (mongoose as any).Promise = global.Promise;

    await connect(mongoose, CONNSTRING);
    await clearCollection(mongoose, MOCK_LEAF_ITEM);
    await clearCollection(mongoose, MOCK_WRATHCHILD_ITEM);
    await clearCollection(mongoose, MOCK_CHILD_ITEM);
    await clearCollection(mongoose, MOCK_ITEM);

    await mongoose.connection.close();
  });

  describe('GET /api/mock-items', () => {
    it('should be able to return a list of `active` items', (done: () => void) => {
      const context = {
        done: (err, response) => {
          expect(err)
            .toBeUndefined();
          expect((response as HttpResponse).status)
            .toEqual(HttpStatusCode.OK);
          expect((response as HttpResponse).body)
            .toHaveProperty('data');
          expect(typeof((response as HttpResponse).body.data))
            .toEqual('object');
          expect((response as HttpResponse).body.data.length)
            .toEqual(1);
          expect((response as HttpResponse).body)
            .toHaveProperty('hasMore');
          expect(typeof((response as HttpResponse).body.hasMore))
            .toEqual('boolean');
          expect((response as HttpResponse).body)
            .toHaveProperty('totalCount');
          expect(typeof((response as HttpResponse).body.totalCount))
            .toEqual('number');

          TEST_ID = (response as HttpResponse).body.data[0]._id;

          done();
        }
      };
      const req = {
        method: HttpMethod.Get
      };

      mock(context, req);
    });

    describe('using criteria', () => {
      it('should be able to return a list of `filtered` items w/null criteria', (done: () => void) => {
        const context = {
          done: (err, response) => {
            expect(err)
              .toBeUndefined();
            expect((response as HttpResponse).status)
              .toEqual(HttpStatusCode.OK);
            expect((response as HttpResponse).body)
              .toHaveProperty('data');
            expect(typeof((response as HttpResponse).body.data))
              .toEqual('object');
            expect((response as HttpResponse).body.data.length)
              .toEqual(0);
            expect((response as HttpResponse).body)
              .toHaveProperty('hasMore');
            expect(typeof((response as HttpResponse).body.hasMore))
              .toEqual('boolean');
            expect((response as HttpResponse).body)
              .toHaveProperty('totalCount');
            expect(typeof((response as HttpResponse).body.totalCount))
              .toEqual('number');

            done();
          }
        };
        const req = {
          method: HttpMethod.Get,
          query: {
            q: 'code:null'
          }
        };

        mock(context, req);
      });

      it('should be able to return a list of `filtered` items w/undefined criteria', (done: () => void) => {
        const context = {
          done: (err, response) => {
            expect(err)
              .toBeUndefined();
            expect((response as HttpResponse).status)
              .toEqual(HttpStatusCode.OK);
            expect((response as HttpResponse).body)
              .toHaveProperty('data');
            expect(typeof((response as HttpResponse).body.data))
              .toEqual('object');
            expect((response as HttpResponse).body.data.length)
              .toEqual(0);
            expect((response as HttpResponse).body)
              .toHaveProperty('hasMore');
            expect(typeof((response as HttpResponse).body.hasMore))
              .toEqual('boolean');
            expect((response as HttpResponse).body)
              .toHaveProperty('totalCount');
            expect(typeof((response as HttpResponse).body.totalCount))
              .toEqual('number');

            done();
          }
        };
        const req = {
          method: HttpMethod.Get,
          query: {
            q: 'code:undefined'
          }
        };

        mock(context, req);
      });

      it('should be able to return a list of `filtered` items w/boolean criteria', (done: () => void) => {
        const context = {
          done: (err, response) => {
            expect(err)
              .toBeUndefined();
            expect((response as HttpResponse).status)
              .toEqual(HttpStatusCode.OK);
            expect((response as HttpResponse).body)
              .toHaveProperty('data');
            expect(typeof((response as HttpResponse).body.data))
              .toEqual('object');
            expect((response as HttpResponse).body.data.length)
              .toEqual(0);
            expect((response as HttpResponse).body)
              .toHaveProperty('hasMore');
            expect(typeof((response as HttpResponse).body.hasMore))
              .toEqual('boolean');
            expect((response as HttpResponse).body)
              .toHaveProperty('totalCount');
            expect(typeof((response as HttpResponse).body.totalCount))
              .toEqual('number');

            done();
          }
        };
        const req = {
          method: HttpMethod.Get,
          query: {
            q: 'code:true,code:false'
          }
        };

        mock(context, req);
      });

      it('should be able to return a list of `filtered` items w/number criteria', (done: () => void) => {
        const context = {
          done: (err, response) => {
            expect(err)
              .toBeUndefined();
            expect((response as HttpResponse).status)
              .toEqual(HttpStatusCode.OK);
            expect((response as HttpResponse).body)
              .toHaveProperty('data');
            expect(typeof((response as HttpResponse).body.data))
              .toEqual('object');
            expect((response as HttpResponse).body.data.length)
              .toEqual(0);
            expect((response as HttpResponse).body)
              .toHaveProperty('hasMore');
            expect(typeof((response as HttpResponse).body.hasMore))
              .toEqual('boolean');
            expect((response as HttpResponse).body)
              .toHaveProperty('totalCount');
            expect(typeof((response as HttpResponse).body.totalCount))
              .toEqual('number');

            done();
          }
        };
        const req = {
          method: HttpMethod.Get,
          query: {
            q: 'code:0,code:1'
          }
        };

        mock(context, req);
      });

      it('should be able to return a list of `filtered` items w/string criteria', (done: () => void) => {
        const context = {
          done: (err, response) => {
            expect(err)
              .toBeUndefined();
            expect((response as HttpResponse).status)
              .toEqual(HttpStatusCode.OK);
            expect((response as HttpResponse).body)
              .toHaveProperty('data');
            expect(typeof((response as HttpResponse).body.data))
              .toEqual('object');
            expect((response as HttpResponse).body.data.length)
              .toEqual(1);
            expect((response as HttpResponse).body)
              .toHaveProperty('hasMore');
            expect(typeof((response as HttpResponse).body.hasMore))
              .toEqual('boolean');
            expect((response as HttpResponse).body)
              .toHaveProperty('totalCount');
            expect(typeof((response as HttpResponse).body.totalCount))
              .toEqual('number');

            done();
          }
        };
        const req = {
          method: HttpMethod.Get,
          query: {
            q: 'code:CODE'
          }
        };

        mock(context, req);
      });

      it('should be able to return a list of `active` items w/empty queries in criteria', (done: () => void) => {
        const context = {
          done: (err, response) => {
            expect(err)
              .toBeUndefined();
            expect((response as HttpResponse).status)
              .toEqual(HttpStatusCode.OK);
            expect((response as HttpResponse).body)
              .toHaveProperty('data');
            expect(typeof((response as HttpResponse).body.data))
              .toEqual('object');
            expect((response as HttpResponse).body.data.length)
              .toEqual(1);
            expect((response as HttpResponse).body)
              .toHaveProperty('hasMore');
            expect(typeof((response as HttpResponse).body.hasMore))
              .toEqual('boolean');
            expect((response as HttpResponse).body)
              .toHaveProperty('totalCount');
            expect(typeof((response as HttpResponse).body.totalCount))
              .toEqual('number');

            TEST_ID = (response as HttpResponse).body.data[0]._id;

            done();
          }
        };
        const req = {
          method: HttpMethod.Get,
          query: {
            q: ','
          }
        };

        mock(context, req);
      });

      it('should be able to return a list of `active` items w/no query in criteria', (done: () => void) => {
        const context = {
          done: (err, response) => {
            expect(err)
              .toBeUndefined();
            expect((response as HttpResponse).status)
              .toEqual(HttpStatusCode.OK);
            expect((response as HttpResponse).body)
              .toHaveProperty('data');
            expect(typeof((response as HttpResponse).body.data))
              .toEqual('object');
            expect((response as HttpResponse).body.data.length)
              .toEqual(1);
            expect((response as HttpResponse).body)
              .toHaveProperty('hasMore');
            expect(typeof((response as HttpResponse).body.hasMore))
              .toEqual('boolean');
            expect((response as HttpResponse).body)
              .toHaveProperty('totalCount');
            expect(typeof((response as HttpResponse).body.totalCount))
              .toEqual('number');

            done();
          }
        };
        const req = {
          method: HttpMethod.Get,
          query: {
            q: 'invalid'
          }
        };

        mock(context, req);
      });

      it('should be able to return an empty list of items w/invalid query in criteria', (done: () => void) => {
        const context = {
          done: (err, response) => {
            expect(err)
              .toBeUndefined();
            expect((response as HttpResponse).status)
              .toEqual(HttpStatusCode.OK);
            expect((response as HttpResponse).body)
              .toHaveProperty('data');
            expect(typeof((response as HttpResponse).body.data))
              .toEqual('object');
            expect((response as HttpResponse).body.data.length)
              .toEqual(0);
            expect((response as HttpResponse).body)
              .toHaveProperty('hasMore');
            expect(typeof((response as HttpResponse).body.hasMore))
              .toEqual('boolean');
            expect((response as HttpResponse).body)
              .toHaveProperty('totalCount');
            expect(typeof((response as HttpResponse).body.totalCount))
              .toEqual('number');

            done();
          }
        };
        const req = {
          method: HttpMethod.Get,
          query: {
            q: 'invalid:'
          }
        };

        mock(context, req);
      });

      it('should be able to return an empty list of items w/invalid queries in criteria', (done: () => void) => {
        const context = {
          done: (err, response) => {
            expect(err)
              .toBeUndefined();
            expect((response as HttpResponse).status)
              .toEqual(HttpStatusCode.OK);
            expect((response as HttpResponse).body)
              .toHaveProperty('data');
            expect(typeof((response as HttpResponse).body.data))
              .toEqual('object');
            expect((response as HttpResponse).body.data.length)
              .toEqual(0);
            expect((response as HttpResponse).body)
              .toHaveProperty('hasMore');
            expect(typeof((response as HttpResponse).body.hasMore))
              .toEqual('boolean');
            expect((response as HttpResponse).body)
              .toHaveProperty('totalCount');
            expect(typeof((response as HttpResponse).body.totalCount))
              .toEqual('number');

            done();
          }
        };
        const req = {
          method: HttpMethod.Get,
          query: {
            q: 'invalid.path:nothing,invalid.path:nothing'
          }
        };

        mock(context, req);
      });
    });

    it('should be able to return a list of all items', (done: () => void) => {
      const context = {
        done: (err, response) => {
          expect(err)
            .toBeUndefined();
          expect((response as HttpResponse).status)
            .toEqual(HttpStatusCode.OK);
          expect((response as HttpResponse).body)
            .toHaveProperty('data');
          expect(typeof((response as HttpResponse).body.data))
            .toEqual('object');
          expect((response as HttpResponse).body.data.length)
            .toEqual(2);
          expect((response as HttpResponse).body)
            .toHaveProperty('hasMore');
          expect(typeof((response as HttpResponse).body.hasMore))
            .toEqual('boolean');
          expect((response as HttpResponse).body)
            .toHaveProperty('totalCount');
          expect(typeof((response as HttpResponse).body.totalCount))
            .toEqual('number');

          done();
        }
      };
      const req = {
        method: HttpMethod.Get,
        query: {
          showInactive: true
        }
      };

      mock(context, req);
    });

    it('should be able to return projected fields', (done: () => void) => {
      const context = {
        done: (err, response) => {
          expect(err)
            .toBeUndefined();
          expect((response as HttpResponse).status)
            .toEqual(HttpStatusCode.OK);
          expect((response as HttpResponse).body)
            .toHaveProperty('data');
          expect(typeof((response as HttpResponse).body.data))
            .toEqual('object');
          expect((response as HttpResponse).body.data.length)
            .toEqual(1);
          expect((response as HttpResponse).body)
            .toHaveProperty('hasMore');
          expect(typeof((response as HttpResponse).body.hasMore))
            .toEqual('boolean');
          expect((response as HttpResponse).body)
            .toHaveProperty('totalCount');
          expect(typeof((response as HttpResponse).body.totalCount))
            .toEqual('number');

          expect((response as HttpResponse).body.data[0])
            .toHaveProperty('code');

          done();
        }
      };
      const req = {
        method: HttpMethod.Get,
        query: {
          fields: 'code'
        }
      };

      mock(context, req);
    });

    it('should be able to return populated fields', (done: () => void) => {
      const context = {
        done: (err, response) => {
          expect(err)
            .toBeUndefined();
          expect((response as HttpResponse).status)
            .toEqual(HttpStatusCode.OK);
          expect((response as HttpResponse).body)
            .toHaveProperty('data');
          expect(typeof((response as HttpResponse).body.data))
            .toEqual('object');
          expect((response as HttpResponse).body.data.length)
            .toEqual(1);
          expect((response as HttpResponse).body)
            .toHaveProperty('hasMore');
          expect(typeof((response as HttpResponse).body.hasMore))
            .toEqual('boolean');
          expect((response as HttpResponse).body)
            .toHaveProperty('totalCount');
          expect(typeof((response as HttpResponse).body.totalCount))
            .toEqual('number');

          expect((response as HttpResponse).body.data[0].child)
            .toHaveProperty('name');

          done();
        }
      };
      const req = {
        method: HttpMethod.Get,
        query: {
          populate: 'child'
        }
      };

      mock(context, req);
    });

    it('should be able to return populated fields (deep)', (done: () => void) => {
      const context = {
        done: (err, response) => {
          expect(err)
            .toBeUndefined();
          expect((response as HttpResponse).status)
            .toEqual(HttpStatusCode.OK);
          expect((response as HttpResponse).body)
            .toHaveProperty('data');
          expect(typeof((response as HttpResponse).body.data))
            .toEqual('object');
          expect((response as HttpResponse).body.data.length)
            .toEqual(1);
          expect((response as HttpResponse).body)
            .toHaveProperty('hasMore');
          expect(typeof((response as HttpResponse).body.hasMore))
            .toEqual('boolean');
          expect((response as HttpResponse).body)
            .toHaveProperty('totalCount');
          expect(typeof((response as HttpResponse).body.totalCount))
            .toEqual('number');

          expect((response as HttpResponse).body.data[0].child)
            .toHaveProperty('name');
          expect((response as HttpResponse).body.data[0].wrathchild)
            .toHaveProperty('name');
          expect((response as HttpResponse).body.data[0].child.wrathchild1)
            .toHaveProperty('name');
          expect((response as HttpResponse).body.data[0].child.wrathchild2)
            .toHaveProperty('name');
          expect((response as HttpResponse).body.data[0].child.wrathchild2.leaf)
            .toHaveProperty('bananas');

          done();
        }
      };
      const req = {
        method: HttpMethod.Get,
        query: {
          populate: 'wrathchild,child:wrathchild1,child:wrathchild2:leaf'
        }
      };

      mock(context, req);
    });

    it('should be able to return items w/pagination', (done: () => void) => {
      const context = {
        done: (err, response) => {
          expect(err)
            .toBeUndefined();
          expect((response as HttpResponse).status)
            .toEqual(HttpStatusCode.OK);
          expect((response as HttpResponse).body)
            .toHaveProperty('data');
          expect(typeof((response as HttpResponse).body.data))
            .toEqual('object');
          expect((response as HttpResponse).body.data.length)
            .toEqual(1);
          expect((response as HttpResponse).body)
            .toHaveProperty('hasMore');
          expect(typeof((response as HttpResponse).body.hasMore))
            .toEqual('boolean');
          expect((response as HttpResponse).body)
            .toHaveProperty('totalCount');
          expect(typeof((response as HttpResponse).body.totalCount))
            .toEqual('number');

          done();
        }
      };
      const req = {
        method: HttpMethod.Get,
        query: {
          page: 0,
          per_page: 1
        }
      };

      mock(context, req);
    });
  });

  describe('GET /api/mock-items/:id', () => {
    it('should be able to return an object conforming the model', (done: () => void) => {
      const context = {
        done: (err, response) => {
          expect(err)
            .toBeUndefined();
          expect((response as HttpResponse).status)
            .toEqual(HttpStatusCode.OK);
          expect((response as HttpResponse).body)
            .toHaveProperty('_id');
          expect(typeof((response as HttpResponse).body._id))
            .toEqual('string');
          expect((response as HttpResponse).body)
            .toHaveProperty('code');
          expect(typeof((response as HttpResponse).body.code))
            .toEqual('string');
          expect((response as HttpResponse).body)
            .toHaveProperty('name');
          expect(typeof((response as HttpResponse).body.name))
            .toEqual('string');

          done();
        }
      };
      const req = {
        method: HttpMethod.Get,
        params: {
          id: TEST_ID
        }
      };

      mock(context, req);
    });

    it('should be able to return an item', (done: () => void) => {
      const context = {
        done: (err, response) => {
          expect(err)
            .toBeUndefined();
          expect((response as HttpResponse).status)
            .toEqual(HttpStatusCode.OK);
          expect((response as HttpResponse).body._id)
            .toEqual(TEST_ID);
          expect((response as HttpResponse).body.code)
            .toEqual(INITIAL_ITEMS[0].code);
          expect((response as HttpResponse).body.name)
            .toEqual(INITIAL_ITEMS[0].name);

          done();
        }
      };
      const req = {
        method: HttpMethod.Get,
        params: {
          id: TEST_ID
        }
      };

      mock(context, req);
    });

    it('should be able to return an item w/projected fields', (done: () => void) => {
      const context = {
        done: (err, response) => {
          expect(err)
            .toBeUndefined();
          expect((response as HttpResponse).status)
            .toEqual(HttpStatusCode.OK);
          expect((response as HttpResponse).body._id)
            .toEqual(TEST_ID);
          expect((response as HttpResponse).body.code)
            .toEqual(INITIAL_ITEMS[0].code);

          done();
        }
      };
      const req = {
        method: HttpMethod.Get,
        query: {
          fields: 'code'
        },
        params: {
          id: TEST_ID
        }
      };

      mock(context, req);
    });

    it('should be able to return an item w/populated fields', (done: () => void) => {
      const context = {
        done: (err, response) => {
          expect(err)
            .toBeUndefined();
          expect((response as HttpResponse).status)
            .toEqual(HttpStatusCode.OK);
          expect((response as HttpResponse).body._id)
            .toEqual(TEST_ID);
          expect((response as HttpResponse).body.code)
            .toEqual(INITIAL_ITEMS[0].code);
          expect((response as HttpResponse).body.name)
            .toEqual(INITIAL_ITEMS[0].name);

          expect((response as HttpResponse).body.child)
            .toHaveProperty('name');

          done();
        }
      };
      const req = {
        method: HttpMethod.Get,
        query: {
          populate: 'child'
        },
        params: {
          id: TEST_ID
        }
      };

      mock(context, req);
    });

    it('should be able to return an item w/populated fields (deep)', (done: () => void) => {
      const context = {
        done: (err, response) => {
          expect(err)
            .toBeUndefined();
          expect((response as HttpResponse).status)
            .toEqual(HttpStatusCode.OK);
          expect((response as HttpResponse).body._id)
            .toEqual(TEST_ID);
          expect((response as HttpResponse).body.code)
            .toEqual(INITIAL_ITEMS[0].code);
          expect((response as HttpResponse).body.name)
            .toEqual(INITIAL_ITEMS[0].name);

          expect((response as HttpResponse).body.child)
            .toHaveProperty('name');
          expect((response as HttpResponse).body.wrathchild)
            .toHaveProperty('name');
          expect((response as HttpResponse).body.child.wrathchild1)
            .toHaveProperty('name');
          expect((response as HttpResponse).body.child.wrathchild2)
            .toHaveProperty('name');
          expect((response as HttpResponse).body.child.wrathchild2.leaf)
            .toHaveProperty('bananas');

          done();
        }
      };
      const req = {
        method: HttpMethod.Get,
        query: {
          populate: 'wrathchild,child:wrathchild1,child:wrathchild2:leaf'
        },
        params: {
          id: TEST_ID
        }
      };

      mock(context, req);
    });

    it('should fail with 404 w/o an existing id', (done: () => void) => {
      const context = {
        done: (err, response) => {
          expect(err)
            .toBeUndefined();
          expect((response as HttpResponse).status)
            .toEqual(HttpStatusCode.NotFound);

          done();
        }
      };
      const req = {
        method: HttpMethod.Get,
        params: {
          id: INVALID_ID
        }
      };

      mock(context, req);
    });
  });

  describe('POST /api/mock-items', () => {
    it('should be able to create new items', (done: () => void) => {
      const context = {
        done: (err, response) => {
          expect(err)
            .toBeUndefined();
          expect((response as HttpResponse).status)
            .toEqual(HttpStatusCode.Created);
          expect((response as HttpResponse).body)
            .toHaveProperty('data');
          expect(typeof((response as HttpResponse).body.data))
            .toEqual('object');
          expect((response as HttpResponse).body.data.length)
            .toEqual(1);
          expect((response as HttpResponse).body.data[0])
            .toHaveProperty('_id');
          expect((response as HttpResponse).body.data[0].code)
            .toEqual(POST_VALUE.code);
          expect((response as HttpResponse).body.data[0].name)
            .toEqual(POST_VALUE.name);
          expect((response as HttpResponse).body)
            .toHaveProperty('hasMore');
          expect(typeof((response as HttpResponse).body.hasMore))
            .toEqual('boolean');
          expect((response as HttpResponse).body.hasMore)
            .toBeFalsy();
          expect((response as HttpResponse).body)
            .toHaveProperty('totalCount');
          expect(typeof((response as HttpResponse).body.totalCount))
            .toEqual('number');

          done();
        }
      };
      const req = {
        method: HttpMethod.Post,
        headers: { 'content-type': 'application/json' },
        body: POST_VALUE
      };

      mock(context, req);
    });

    it('should fail with 400 w/o `content-type` header', (done: () => void) => {
      const context = {
        done: (err, response) => {
          expect(err)
            .toBeUndefined();
          expect((response as HttpResponse).status)
            .toEqual(HttpStatusCode.BadRequest);

          done();
        }
      };
      const req = {
        method: HttpMethod.Post
      };

      mock(context, req);
    });

    it('should fail with 400 w/o request body', (done: () => void) => {
      const context = {
        done: (err, response) => {
          expect(err)
            .toBeUndefined();
          expect((response as HttpResponse).status)
            .toEqual(HttpStatusCode.BadRequest);

          done();
        }
      };
      const req = {
        method: HttpMethod.Post,
        headers: { 'content-type': 'application/json' }
      };

      mock(context, req);
    });

    it('should fail with 409 on idempotent request', (done: () => void) => {
      const context = {
        done: (err, response) => {
          expect(err)
            .toBeUndefined();
          expect((response as HttpResponse).status)
            .toEqual(HttpStatusCode.Conflict);

          done();
        }
      };
      const req = {
        method: HttpMethod.Post,
        headers: { 'content-type': 'application/json' },
        body: {
          _id: TEST_ID,
          ...POST_VALUE
        }
      };

      mock(context, req);
    });

    it('should fail with 422 w/o required properties', (done: () => void) => {
      const context = {
        done: (err, response) => {
          expect(err)
            .toBeUndefined();
          expect((response as HttpResponse).status)
            .toEqual(HttpStatusCode.UnprocessableEntity);

          done();
        }
      };
      const req = {
        method: HttpMethod.Post,
        headers: { 'content-type': 'application/json' },
        body: INVALID_VALUE
      };

      mock(context, req);
    });
  });

  describe('PATCH /api/mock-items/:id', () => {
    it('should be able to update an existing item', (done: () => void) => {
      const context = {
        done: (err, response) => {
          expect(err)
            .toBeUndefined();
          expect((response as HttpResponse).status)
            .toEqual(HttpStatusCode.OK);
          expect((response as HttpResponse).body._id)
            .toEqual(TEST_ID);
          expect((response as HttpResponse).body.code)
            .toEqual(PATCH_VALUE.code);
          expect((response as HttpResponse).body.name)
            .toEqual(INITIAL_ITEMS[0].name);

          done();
        }
      };
      const req = {
        method: HttpMethod.Patch,
        headers: { 'content-type': 'application/json' },
        body: PATCH_VALUE,
        params: {
          id: TEST_ID
        }
      };

      mock(context, req);
    });

    it('should fail with 400 w/o `content-type` header', (done: () => void) => {
      const context = {
        done: (err, response) => {
          expect(err)
            .toBeUndefined();
          expect((response as HttpResponse).status)
            .toEqual(HttpStatusCode.BadRequest);

          done();
        }
      };
      const req = {
        method: HttpMethod.Patch,
        body: PATCH_VALUE
      };

      mock(context, req);
    });

    it('should fail with 400 w/o id', (done: () => void) => {
      const context = {
        done: (err, response) => {
          expect(err)
            .toBeUndefined();
          expect((response as HttpResponse).status)
            .toEqual(HttpStatusCode.BadRequest);

          done();
        }
      };
      const req = {
        method: HttpMethod.Patch,
        headers: { 'content-type': 'application/json' },
        body: PATCH_VALUE
      };

      mock(context, req);
    });

    it('should fail with 400 w/o an existing id', (done: () => void) => {
      const context = {
        done: (err, response) => {
          expect(err)
            .toBeUndefined();
          expect((response as HttpResponse).status)
            .toEqual(HttpStatusCode.BadRequest);

          done();
        }
      };
      const req = {
        method: HttpMethod.Patch,
        headers: { 'content-type': 'application/json' },
        body: PATCH_VALUE,
        params: {
          id: INVALID_ID
        }
      };

      mock(context, req);
    });

    it('should fail with 400 w/o request body', (done: () => void) => {
      const context = {
        done: (err, response) => {
          expect(err)
            .toBeUndefined();
          expect((response as HttpResponse).status)
            .toEqual(HttpStatusCode.BadRequest);

          done();
        }
      };
      const req = {
        method: HttpMethod.Patch,
        headers: { 'content-type': 'application/json' },
        params: {
          id: INVALID_ID
        }
      };

      mock(context, req);
    });
  });

  describe('DELETE /api/mock-items/:id', () => {
    it('should be able to deactivate an existing item', (done: () => void) => {
      const context = {
        done: (err, response) => {
          expect(err)
            .toBeUndefined();
          expect((response as HttpResponse).status)
            .toEqual(HttpStatusCode.OK);
          expect((response as HttpResponse).body.deactivated)
            .toBeTruthy();
          expect((response as HttpResponse).body._id)
            .toEqual(TEST_ID);

          done();
        }
      };
      const req = {
        method: HttpMethod.Delete,
        params: {
          id: TEST_ID
        }
      };

      mock(context, req);
    });

    it('should fail with 400 w/o id', (done: () => void) => {
      const context = {
        done: (err, response) => {
          expect(err)
            .toBeUndefined();
          expect((response as HttpResponse).status)
            .toEqual(HttpStatusCode.BadRequest);

          done();
        }
      };
      const req = {
        method: HttpMethod.Delete
      };

      mock(context, req);
    });

    it('should fail with 400 w/o an existing id', (done: () => void) => {
      const context = {
        done: (err, response) => {
          expect(err)
            .toBeUndefined();
          expect((response as HttpResponse).status)
            .toEqual(HttpStatusCode.BadRequest);

          done();
        }
      };
      const req = {
        method: HttpMethod.Delete,
        params: {
          id: INVALID_ID
        }
      };

      mock(context, req);
    });
  });

  describe('XYZ /api/mock-items', () => {
    it('should fail with 405 w/any other Http method', (done: () => void) => {
      const context = {
        done: (err, response) => {
          expect(err)
            .toBeUndefined();
          expect((response as HttpResponse).status)
            .toEqual(HttpStatusCode.MethodNotAllowed);
          expect((response as HttpResponse).body)
            .toEqual({
            error: {
              type: 'not_supported',
              message: 'Method XYZ not supported.'
            }
          });

          done();
        }
      };
      const req = {
        method: 'XYZ' as HttpMethod
      };

      mock(context, req);
    });
  });

  describe('connect', () => {
    it('should fail w/incorrect connection strings', async () => {
      (mongoose as any).Promise = global.Promise;

      connect(mongoose, '', 10)
        .catch(err => {
          expect(err.toString())
            .toContain('Invalid mongodb uri');
        });
    });
  });
});
